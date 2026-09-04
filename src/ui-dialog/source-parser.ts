import { EngineId } from '../types';
import { resolveStateItemImageReference } from '../utils/item-image';
import { legendColor, resolveLegendColorIndex } from '../utils/legend-colors';
import { resolveMonsterRepresentativeAsset } from '../utils/monster-image';
import { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import {
  findScriptCommandInvocations,
  ScriptCommandInvocation,
  ScriptTextSpan,
} from '../utils/command-arguments';
import {
  DialogAssetLayer,
  DialogAssetReference,
  DialogAssetStateDiagnostic,
  DialogAnimationField,
  DialogAnimationPreview,
  DialogActUiCommand,
  DialogActUiField,
  DialogActUiPreview,
  DialogAddButtonDeleteAction,
  DialogAddButtonEffectPreview,
  DialogAddButtonPreview,
  DialogAddDlgWindow,
  DialogBackground,
  DialogConditionGroup,
  DialogConditionOperator,
  DialogContainerPreview,
  DialogCoordinate,
  DialogCoordinateBinding,
  DialogCostItemPreview,
  DialogCountdownPreview,
  DialogDisplayValueSource,
  DialogElement,
  DialogElementParameter,
  DialogElementKind,
  DialogInputPreview,
  DialogItemGridField,
  DialogItemGridSource,
  DialogItemPreview,
  DialogItemPreviewField,
  DialogListViewField,
  DialogListViewFieldDiagnostic,
  DialogListViewScrollbarDiagnostic,
  DialogImagePreview,
  DialogImageGlyph,
  DialogImageTextField,
  DialogImageTextPreview,
  DialogLayoutPreview,
  DialogMenuAssetDiagnostic,
  DialogMenuAssetField,
  DialogMenuPreview,
  DialogModelField,
  DialogModelPreview,
  DialogMonsterPreview,
  DialogPagePreview,
  DialogProgressPreview,
  DialogResolvedVariable,
  DialogRuntimeActionPreview,
  DialogScene,
  DialogSliderPreview,
  DialogSizeAxisPreview,
  DialogSizePreview,
  DialogTextFieldSourceDiagnostic,
  DialogTextPreview,
  DialogTextPreviewField,
  DialogTextRun,
  DialogTextValueStatus,
  DialogTooltipPreview,
  DialogTogglePreview,
  NpcDialogDocumentModel,
  NpcDialogOffsets,
  SourceSpan,
} from './model';
import { resolveItemFrameAssetReference } from './item-preview';
import { DialogStatementSchema } from './statement-catalog';
import {
  DialogLabelVariableResolution,
  DialogResolvedLine,
  resolveDialogVariables,
} from './variable-resolver';

const MAX_CANVAS_SIZE = 4096;
const DEFAULT_PREVIEW_WIDTH = 800;
const DEFAULT_PREVIEW_HEIGHT = 600;
// The 996PC manuals document iwidth/iheight but not the omitted defaults or
// inter-cell spacing. Keep the established Ctrl+F12 appearance as an explicit
// preview convention instead of presenting these numbers as client behavior.
const ITEM_GRID_PREVIEW_CELL_SIZE = 40;
const ITEM_GRID_PREVIEW_GAP = 2;
// The MenuItem manual names itemhei but does not publish its omitted, dynamic,
// or invalid client fallback. Keep the established 30px preview explicit.
const MENU_ITEM_PREVIEW_HEIGHT = 30;

interface ScriptLine {
  text: string;
  start: number;
  end: number;
  fullEnd: number;
  lineNumber: number;
}

interface ScriptFunctionSection {
  label: string;
  start: number;
  labelEnd: number;
  end: number;
  lines: ScriptLine[];
}

interface ValueSpan {
  start: number;
  end: number;
  raw: string;
}

interface ParsedStatementValues {
  positional: ValueSpan[];
  keyed: Map<string, ValueSpan>;
  keyNames: Map<string, string>;
}

interface DialogSourceDocument {
  uri: string;
  filePath: string;
  documentVersion: number;
}

interface StatementContainerBinding {
  parentId?: string;
  elementId?: string;
  childIds: string[];
  shifted: boolean;
  raw?: ValueSpan;
}

interface FlowLayoutCursor {
  originX: number;
  x: number;
  y: number;
  lineHeight: number;
}

interface StatementControlPreview {
  parameters: DialogElementParameter[];
  assetLayers?: DialogAssetLayer[];
  assetStateDiagnostics?: DialogAssetStateDiagnostic[];
  itemPreview?: DialogItemPreview;
  costItemPreview?: DialogCostItemPreview;
  progressPreview?: DialogProgressPreview;
  sliderPreview?: DialogSliderPreview;
  runtimeActionPreview?: DialogRuntimeActionPreview;
  inputPreview?: DialogInputPreview;
  togglePreview?: DialogTogglePreview;
  textPreview?: DialogTextPreview;
  menuPreview?: DialogMenuPreview;
  countdownPreview?: DialogCountdownPreview;
  imageTextPreview?: DialogImageTextPreview;
  imagePreview?: DialogImagePreview;
  modelPreview?: DialogModelPreview;
  monsterPreview?: DialogMonsterPreview;
  animationPreview?: DialogAnimationPreview;
  containerPreview?: DialogContainerPreview;
  warning?: string;
}

interface CoalescedConditionGroups {
  groups: DialogConditionGroup[];
  aliases: Map<string, string>;
  expandedStates: Record<string, boolean>;
}

interface StatementMonsterControl {
  preview: DialogMonsterPreview;
  assetRef?: DialogAssetReference;
  warning: string;
}

export interface ParseNpcDialogOptions {
  uri: string;
  fileName: string;
  filePath: string;
  documentVersion: number;
  engine: EngineId;
  engineLabel: string;
  cursorOffset: number;
  offsets: NpcDialogOffsets;
  catalog: DialogStatementSchema[];
  conditionStates?: Readonly<Record<string, boolean>>;
  dataOptions?: NestedVariableAnalysisOptions;
}

export function parseNpcDialogDocument(
  text: string,
  options: ParseNpcDialogOptions
): NpcDialogDocumentModel {
  const lines = scanScriptLines(text);
  const linesByNumber = new Map(lines.map(line => [line.lineNumber, line]));
  const sections = findFunctionSections(text, lines);
  const root = findFunctionAtOffset(sections, options.cursorOffset);
  if (!root) throw new Error('请将光标放在一个 [@函数] 内再按 Ctrl+F12');

  const warnings: string[] = [];
  const sourceDocument: DialogSourceDocument = {
    uri: options.uri,
    filePath: options.filePath,
    documentVersion: options.documentVersion,
  };
  const addDlgWindows = options.engine === 'GOM'
    ? parseGomAddDlgWindows(text, root, sourceDocument)
    : options.engine === 'GEE'
      ? parseGeeAddDlgWindows(text, root, sourceDocument)
      : [];
  const reachable = findReachableSections(text, sections, root);
  const rawConditionGroups = reachable.flatMap(section => (
    collectConditionGroups(section, options.conditionStates)
  ));
  const coalescedConditions = coalesceEquivalentConditionGroups(
    rawConditionGroups,
    options.conditionStates
  );
  const conditionGroups = coalescedConditions.groups;
  renumberVisibleConditionTitles(conditionGroups);
  const variableResolution = resolveDialogVariables(text, {
    rootLabel: root.label,
    targetLabels: reachable.map(section => section.label),
    engine: options.engine,
    conditionStates: coalescedConditions.expandedStates,
    dataOptions: options.dataOptions,
  });
  warnings.push(...variableResolution.warnings);
  const actUiPreviews = collectActUiPreviews(
    text,
    reachable,
    options.engine,
    variableResolution.byLabel
  );
  const schemasByToken = groupSchemas(options.catalog);
  const scenes: DialogScene[] = [];
  for (const section of reachable) {
    const sectionScenes = parseSectionScenes(
      text,
      linesByNumber,
      section,
      options.engine,
      options.offsets,
      schemasByToken,
      coalescedConditions.aliases,
      sourceDocument,
      variableResolution.byLabel.get(normalizeLabel(section.label))
    );
    scenes.push(...sectionScenes);
    if (sectionScenes.length === 0) {
      const fallback = parseStaticSectionScene(
        text,
        linesByNumber,
        section,
        options.engine,
        options.offsets,
        schemasByToken,
        sourceDocument,
        variableResolution.byLabel.get(normalizeLabel(section.label))
      );
      if (fallback) scenes.push(fallback);
    }
  }

  if (options.engine === 'GEE' && addDlgWindows.length > 0) {
    scenes.push(...createGeeAddDlgScenes(addDlgWindows, options.offsets, schemasByToken));
  }

  if (scenes.some(scene => scene.marker === 'STATIC')) {
    warnings.push('部分函数没有 #SAY/#ELSESAY，已按静态界面语句生成只读场景');
  }
  if (options.engine === 'GOM') {
    attachGomAddDlgWindows(text, sections, scenes, addDlgWindows);
  }
  attachAddButtonActionPreviews(
    text,
    reachable,
    scenes,
    options.engine,
    variableResolution.byLabel
  );
  for (const window of addDlgWindows) warnings.push(...window.warnings);
  const activePreviewPath = Object.fromEntries(
    conditionGroups.map(group => [group.id, group.satisfied])
  );
  for (const scene of scenes) {
    scene.previewPath = scene.conditionGroupId
      ? { ...activePreviewPath }
      : Object.fromEntries(conditionGroups.map(group => [group.id, false]));
    if (scene.conditionGroupId) {
      scene.previewPath[scene.conditionGroupId] = scene.marker !== '#ELSESAY';
    }
  }
  if (!options.offsets.configured && hasRelativeCoordinates(scenes)) {
    warnings.push(`${options.engineLabel} 未配置 NPC 对话框文字坐标修正，当前按 0,0 预览`);
  }

  const canvas = calculateCanvasSize(scenes, options.offsets);
  applyShowPositionedBackgroundLayout(scenes, {
    width: DEFAULT_PREVIEW_WIDTH,
    height: DEFAULT_PREVIEW_HEIGHT,
  });
  const pages = composeDialogPages(scenes, conditionGroups);
  return {
    uri: options.uri,
    fileName: options.fileName,
    filePath: options.filePath,
    documentVersion: options.documentVersion,
    engine: options.engine,
    engineLabel: options.engineLabel,
    functionLabel: root.label,
    functionStart: root.start,
    functionEnd: root.end,
    offsets: options.offsets,
    clientWidth: DEFAULT_PREVIEW_WIDTH,
    clientHeight: DEFAULT_PREVIEW_HEIGHT,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    conditionGroups,
    addDlgWindows,
    companionUris: [],
    companionFilePaths: [],
    companionCandidateFilePaths: [],
    scenes,
    pages,
    actUiPreviews,
    warnings,
  };
}

export function reflowNpcDialogLayout(model: NpcDialogDocumentModel): void {
  for (const scene of model.scenes) {
    applyContainerLayout(scene.elements, model.offsets, scene.warnings);
  }
  const canvas = calculateCanvasSize(model.scenes, model.offsets);
  applyShowPositionedBackgroundLayout(model.scenes, {
    width: model.clientWidth || DEFAULT_PREVIEW_WIDTH,
    height: model.clientHeight || DEFAULT_PREVIEW_HEIGHT,
  });
  model.canvasWidth = canvas.width;
  model.canvasHeight = canvas.height;
  model.pages = composeDialogPages(model.scenes, model.conditionGroups);
}

export function composeDialogPages(
  scenes: readonly DialogScene[],
  conditionGroups: readonly DialogConditionGroup[]
): DialogPagePreview[] {
  const orderedLabels = [...new Set(scenes.map(scene => scene.sourceLabel))];
  const states = new Map(conditionGroups.map(group => [group.id, group.satisfied]));
  return orderedLabels.map(sourceLabel => {
    const pageScenes = scenes.filter(scene => scene.sourceLabel === sourceLabel);
    const activeScenes = pageScenes.filter(scene => {
      if (!scene.conditionGroupId || scene.conditions.length === 0) return true;
      const satisfied = states.get(scene.conditionGroupId) === true;
      return scene.marker === '#ELSESAY' ? !satisfied : satisfied;
    });
    const pageGroups = conditionGroups.filter(group => group.sourceLabel === sourceLabel);
    const satisfiedCount = pageGroups.filter(group => group.satisfied).length;
    // Every scene receives the background lifecycle state as of its own #SAY.
    // Selecting the last active scene prevents a preceding OPEN from being
    // resurrected after a matching CLOSE in a later output block.
    const background = activeScenes.at(-1)?.background;
    const addDlgWindow = activeScenes.find(scene => scene.addDlgWindow)?.addDlgWindow
      || pageScenes.find(scene => scene.addDlgWindow)?.addDlgWindow;
    return {
      id: `PAGE:${normalizeLabel(sourceLabel)}`,
      title: sourceLabel,
      sourceLabel,
      conditionSummary: pageGroups.length > 0
        ? `${pageGroups.length} 个条件，${satisfiedCount} 个满足`
        : '默认界面',
      conditionGroupIds: pageGroups.map(group => group.id),
      activeBranchIds: activeScenes
        .filter(scene => Boolean(scene.conditionGroupId))
        .map(scene => scene.id),
      background,
      addDlgWindow,
      elements: uniqueById(activeScenes.flatMap(scene => scene.elements)),
      unsupportedStatements: [...new Set(activeScenes.flatMap(scene => scene.unsupportedStatements))],
      warnings: [...new Set(activeScenes.flatMap(scene => scene.warnings))],
      resolvedVariables: uniqueVariables(activeScenes.flatMap(scene => scene.resolvedVariables)),
    };
  });
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!result.has(value.id)) result.set(value.id, value);
  }
  return [...result.values()];
}

function uniqueVariables(values: readonly DialogResolvedVariable[]): DialogResolvedVariable[] {
  const result = new Map<string, DialogResolvedVariable>();
  for (const value of values) result.set(value.name, value);
  return [...result.values()];
}

export function scanScriptLines(text: string): ScriptLine[] {
  const result: ScriptLine[] = [];
  const expression = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  let lineNumber = 0;
  while ((match = expression.exec(text)) !== null) {
    if (!match[0]) break;
    const content = match[0].replace(/[\r\n]+$/, '');
    result.push({
      text: content,
      start: match.index,
      end: match.index + content.length,
      fullEnd: match.index + match[0].length,
      lineNumber,
    });
    lineNumber++;
  }
  return result;
}

function findFunctionSections(text: string, lines: ScriptLine[]): ScriptFunctionSection[] {
  const labels: Array<Omit<ScriptFunctionSection, 'end' | 'lines'>> = [];
  for (const line of lines) {
    if (/^\s*;/.test(line.text)) continue;
    const match = /^\uFEFF?\s*\[(@[^\]]+)\]/.exec(line.text);
    if (!match) continue;
    const bracketIndex = line.text.indexOf('[', match.index);
    labels.push({
      label: match[1],
      start: line.start + Math.max(0, bracketIndex),
      labelEnd: line.start + match.index + match[0].length,
    });
  }
  return labels.map((label, index) => {
    const end = labels[index + 1]?.start ?? text.length;
    return {
      ...label,
      end,
      lines: lines.filter(line => line.start >= label.start && line.start < end),
    };
  });
}

function findFunctionAtOffset(
  sections: ScriptFunctionSection[],
  cursorOffset: number
): ScriptFunctionSection | undefined {
  return sections.find(section => section.start <= cursorOffset && cursorOffset < section.end)
    || [...sections].reverse().find(section => section.start <= cursorOffset);
}

function findReachableSections(
  text: string,
  sections: ScriptFunctionSection[],
  root: ScriptFunctionSection
): ScriptFunctionSection[] {
  const byName = new Map(sections.map(section => [normalizeLabel(section.label), section]));
  const queue = [root];
  const visited = new Set<string>();
  const result: ScriptFunctionSection[] = [];
  while (queue.length > 0) {
    const section = queue.shift()!;
    const key = normalizeLabel(section.label);
    if (visited.has(key)) continue;
    visited.add(key);
    result.push(section);
    const source = text.slice(section.labelEnd, section.end);
    for (const reference of linkedFunctionReferences(source)) {
      const target = cleanTargetLabel(reference);
      if (!target || target.includes('<$')) continue;
      const linked = byName.get(normalizeLabel(target));
      if (linked && !visited.has(normalizeLabel(linked.label))) queue.push(linked);
    }
  }
  return result;
}

function linkedFunctionReferences(source: string): string[] {
  const result = new Set<string>();
  const patterns = [
    /\bGOTO\s+(@[^\s;]+)/gi,
    /\/\s*(@[^>\s|}]+)/g,
    /\b(?:LINK|CLICK|ACTION|EVENT|ONCLICK)\s*=\s*(@[^|>\s},]+)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) result.add(match[1]);
  }
  for (const line of source.split(/\r\n|\n|\r/)) {
    const invocation = findScriptCommandInvocations(line, typedName => (
      /^AddDlg$/i.test(typedName) ? 'AddDlg' : undefined
    )).find(candidate => candidate.form === 'line');
    const target = invocation?.arguments[7]?.text;
    if (target?.startsWith('@')) result.add(target);
  }
  return [...result];
}

const ADDDLG_CREATE_POSITION_LABELS = [
  '屏幕上', '装备对话框上', '装备', '时装', '状态', '属性', '称号', '技能', '出战',
  '包裹', '聊天框左侧界面', '聊天框右侧界面', '商铺界面', '查看对方装备对话框上',
  '查看对方装备', '查看对方时装', '查看对方称号', '大地图', '生肖盒', '对方生肖盒',
  '首饰盒', '对方首饰盒',
];

function createPairCoordinateBinding(
  source: string,
  line: ScriptLine,
  argument: ScriptTextSpan | undefined,
  x: number | undefined,
  y: number | undefined,
  targetKind: DialogCoordinateBinding['targetKind'],
  commandStart: number,
  sourceDocument: DialogSourceDocument
): DialogCoordinateBinding | undefined {
  if (!argument || x === undefined || y === undefined) return undefined;
  const separator = argument.text.indexOf(':');
  if (separator <= 0 || separator !== argument.text.lastIndexOf(':')) return undefined;
  const xRaw = argument.text.slice(0, separator);
  const yRaw = argument.text.slice(separator + 1);
  if (!xRaw || !yRaw) return undefined;
  const absoluteStart = line.start + argument.start;
  const xSpan = span(source, absoluteStart, absoluteStart + xRaw.length);
  const yStart = absoluteStart + separator + 1;
  const ySpan = span(source, yStart, yStart + yRaw.length);
  return {
    id: `${commandStart}:${targetKind}`,
    targetKind,
    sourceRange: span(source, absoluteStart, line.start + argument.end),
    sourceUri: sourceDocument.uri,
    sourceFilePath: sourceDocument.filePath,
    sourceDocumentVersion: sourceDocument.documentVersion,
    editable: true,
    x: coordinate({ start: xSpan.start, end: xSpan.end, raw: xSpan.original }, x, x),
    y: coordinate({ start: ySpan.start, end: ySpan.end, raw: ySpan.original }, y, y),
  };
}

function createSeparatedCoordinateBinding(
  source: string,
  line: ScriptLine,
  xArgument: ScriptTextSpan | undefined,
  yArgument: ScriptTextSpan | undefined,
  x: number | undefined,
  y: number | undefined,
  targetKind: DialogCoordinateBinding['targetKind'],
  commandStart: number,
  sourceDocument: DialogSourceDocument
): DialogCoordinateBinding | undefined {
  if (!xArgument || !yArgument || x === undefined || y === undefined) return undefined;
  const xStart = line.start + xArgument.start;
  const xEnd = line.start + xArgument.end;
  const yStart = line.start + yArgument.start;
  const yEnd = line.start + yArgument.end;
  if (xEnd > yStart) return undefined;
  const xSpan = span(source, xStart, xEnd);
  const ySpan = span(source, yStart, yEnd);
  return {
    id: `${commandStart}:${targetKind}`,
    targetKind,
    sourceRange: span(source, xStart, yEnd),
    sourceUri: sourceDocument.uri,
    sourceFilePath: sourceDocument.filePath,
    sourceDocumentVersion: sourceDocument.documentVersion,
    editable: true,
    x: coordinate({ start: xSpan.start, end: xSpan.end, raw: xSpan.original }, x, x),
    y: coordinate({ start: ySpan.start, end: ySpan.end, raw: ySpan.original }, y, y),
  };
}

function parseGomAddDlgWindows(
  source: string,
  section: ScriptFunctionSection,
  sourceDocument: DialogSourceDocument
): DialogAddDlgWindow[] {
  const result: DialogAddDlgWindow[] = [];
  for (const line of section.lines.slice(1)) {
    const invocation = findScriptCommandInvocations(line.text, typedName => (
      /^AddDlg$/i.test(typedName) ? 'AddDlg' : undefined
    )).find(candidate => candidate.form === 'line');
    if (!invocation) continue;
    const args = invocation.arguments.map(argument => argument.text);
    const dynamicFields: string[] = [];
    const invalidFields: string[] = [];
    const warnings: string[] = [];
    const numeric = (index: number, field: string): number | undefined => {
      const raw = args[index];
      if (raw === undefined) {
        invalidFields.push(field);
        return undefined;
      }
      if (/<\$/i.test(raw)) {
        dynamicFields.push(field);
        return undefined;
      }
      const value = parseInteger(raw);
      if (value === undefined) invalidFields.push(field);
      return value;
    };
    const binary = (index: number, field: string): boolean | undefined => {
      const value = numeric(index, field);
      if (value === undefined) return undefined;
      if (value !== 0 && value !== 1) {
        invalidFields.push(field);
        return undefined;
      }
      return value === 1;
    };
    const pair = (index: number, field: string): [number | undefined, number | undefined] => {
      const raw = args[index];
      if (!raw) {
        invalidFields.push(field);
        return [undefined, undefined];
      }
      if (/<\$/i.test(raw)) {
        dynamicFields.push(field);
        return [undefined, undefined];
      }
      const parts = raw.split(':');
      if (parts.length !== 2) {
        invalidFields.push(field);
        return [undefined, undefined];
      }
      const left = parseInteger(parts[0]);
      const right = parseInteger(parts[1]);
      if (left === undefined || right === undefined) invalidFields.push(field);
      return [left, right];
    };

    const dialogId = numeric(0, 'dialogId');
    if (dialogId !== undefined && (dialogId < 1 || dialogId > 100)) invalidFields.push('dialogId');
    const resourceRaw = args[1];
    const resourceNumber = parseInteger(resourceRaw);
    const resourceDynamic = Boolean(resourceRaw && /<\$/i.test(resourceRaw));
    if (resourceDynamic) dynamicFields.push('resource');
    else if (!resourceRaw) invalidFields.push('resource');
    const imageIndex = numeric(2, 'backgroundImage');
    const movable = binary(3, 'movable');
    const [windowX, windowY] = pair(4, 'windowOrigin');
    const [textOffsetX, textOffsetY] = pair(5, 'textOffset');
    const createPosition = numeric(6, 'createPosition');
    if (createPosition !== undefined && (createPosition < 0 || createPosition > 21)) {
      invalidFields.push('createPosition');
    }
    const qfRaw = args[7];
    const qfTarget = qfRaw && !/<\$/i.test(qfRaw) ? cleanTargetLabel(qfRaw) : undefined;
    if (qfRaw && /<\$/i.test(qfRaw)) dynamicFields.push('qfTarget');
    else if (!qfTarget?.startsWith('@')) invalidFields.push('qfTarget');
    const [parentSyncMove, refreshCoordinates] = parseAddDlgBinaryPair(
      args[8], 'parentBehavior', dynamicFields, invalidFields
    );
    const popup = parseAddDlgPopup(args[9], dynamicFields, invalidFields);
    if (args.length > 10) warnings.push('AddDlg 超过官方 10 个参数，多余参数未解释');
    if (dynamicFields.length > 0) {
      warnings.push(`AddDlg 的 ${[...new Set(dynamicFields)].join('、')} 包含动态值，静态预览保持未知`);
    }
    if (invalidFields.length > 0) {
      warnings.push(`AddDlg 的 ${[...new Set(invalidFields)].join('、')} 参数无效或缺失，静态预览不猜测`);
    }
    if (popup.displayMode !== 0) {
      warnings.push('AddDlg 渐缓弹出的真实曲线和父组件可见状态属于客户端运行时；Ctrl+F12 展示配置并使用静态窗口');
    }
    const absoluteStart = line.start + invocation.commandSpan.start;
    const absoluteEnd = line.start + (invocation.arguments.at(-1)?.end ?? invocation.commandSpan.end);
    const windowOriginBinding = createPairCoordinateBinding(
      source,
      line,
      invocation.arguments[4],
      windowX,
      windowY,
      'adddlg-window-origin',
      absoluteStart,
      sourceDocument
    );
    const contentOriginBinding = createPairCoordinateBinding(
      source,
      line,
      invocation.arguments[5],
      textOffsetX,
      textOffsetY,
      'adddlg-content-origin',
      absoluteStart,
      sourceDocument
    );
    result.push({
      id: `${absoluteStart}:gom-adddlg:${dialogId ?? result.length + 1}`,
      command: 'ADDDLG',
      dialogId,
      raw: source.slice(absoluteStart, absoluteEnd),
      lineNumber: line.lineNumber + 1,
      sourceRange: span(source, absoluteStart, absoluteEnd),
      sourceUri: sourceDocument.uri,
      sourceFilePath: sourceDocument.filePath,
      sourceDocumentVersion: sourceDocument.documentVersion,
      ...(imageIndex !== undefined && !resourceDynamic && resourceRaw ? {
        assetRef: resourceNumber !== undefined
          ? { willIndex: resourceNumber, imageIndex }
          : { archiveName: resourceRaw, imageIndex },
      } : {}),
      movable,
      windowX,
      windowY,
      ...(windowOriginBinding ? { windowOriginBinding } : {}),
      textOffsetX,
      textOffsetY,
      ...(contentOriginBinding ? { contentOriginBinding } : {}),
      createPosition,
      ...(createPosition !== undefined && createPosition >= 0 && createPosition <= 21
        ? { createPositionLabel: ADDDLG_CREATE_POSITION_LABELS[createPosition] }
        : {}),
      qfTarget,
      parentSyncMove,
      refreshCoordinates,
      ...popup,
      closeActions: [],
      dynamicFields: [...new Set(dynamicFields)],
      invalidFields: [...new Set(invalidFields)],
      warnings,
    });
  }
  return result;
}

const GEE_ADDDLG_CREATE_POSITION_LABELS: Readonly<Record<number, string>> = {
  0: '位置 0',
  1: '位置 1',
  2: '人物装备栏',
  3: '人物背包栏',
  4: '英雄装备栏',
  5: '英雄背包栏',
  6: '聊天框左侧龙界面',
  7: '聊天框右侧等级界面',
  8: '商铺界面',
  9: '时装界面',
  10: '英雄时装',
  11: '技能栏',
  12: '英雄技能栏',
  13: '称号栏',
  14: '英雄称号栏',
  15: '状态栏',
  16: '英雄状态栏',
  17: '属性栏',
  18: '英雄属性栏',
  19: '人物出战栏',
  20: '行会界面',
  21: '详细属性位置',
  22: '宠物界面',
  23: '宠物背包',
  24: '人物首饰',
  25: '英雄首饰',
  26: '人物神佑',
  27: '英雄神佑',
  28: '查看他人装备',
  29: '查看他人时装',
  30: '查看他人称号',
  31: '查看他人首饰盒',
  32: '查看他人神佑袋',
  33: 'M大地图',
  42: '可视化默认仓库',
  43: '可视化无限仓库',
};

function parseGeeAddDlgWindows(
  source: string,
  section: ScriptFunctionSection,
  sourceDocument: DialogSourceDocument
): DialogAddDlgWindow[] {
  const result: DialogAddDlgWindow[] = [];
  const closeActions = collectAddDlgCloseActions([section]);
  for (const line of section.lines.slice(1)) {
    const invocation = findScriptCommandInvocations(line.text, typedName => {
      if (/^AddDlgEx$/i.test(typedName)) return 'ADDDLGEX' as const;
      if (/^AddDlg$/i.test(typedName)) return 'ADDDLG' as const;
      return undefined;
    }).find(candidate => candidate.form === 'line');
    if (!invocation) continue;
    const command = invocation.command;
    const args = invocation.arguments.map(argument => argument.text);
    const dynamicFields: string[] = [];
    const invalidFields: string[] = [];
    const warnings: string[] = [];
    const numeric = (index: number, field: string): number | undefined => {
      const raw = args[index];
      if (raw === undefined || raw === '') {
        invalidFields.push(field);
        return undefined;
      }
      if (/<\$/i.test(raw)) {
        dynamicFields.push(field);
        return undefined;
      }
      const value = parseInteger(raw);
      if (value === undefined) invalidFields.push(field);
      return value;
    };
    const binary = (index: number, field: string): boolean | undefined => {
      const value = numeric(index, field);
      if (value === undefined) return undefined;
      if (value !== 0 && value !== 1) {
        invalidFields.push(field);
        return undefined;
      }
      return value === 1;
    };
    const pair = (index: number, field: string): [number | undefined, number | undefined] => {
      const raw = args[index];
      if (!raw) {
        invalidFields.push(field);
        return [undefined, undefined];
      }
      if (/<\$/i.test(raw)) {
        dynamicFields.push(field);
        return [undefined, undefined];
      }
      const parts = raw.split(':');
      const left = parts.length === 2 ? parseInteger(parts[0]) : undefined;
      const right = parts.length === 2 ? parseInteger(parts[1]) : undefined;
      if (left === undefined || right === undefined) invalidFields.push(field);
      return [left, right];
    };

    const dialogId = numeric(0, 'dialogId');
    if (dialogId !== undefined && (dialogId < 1 || dialogId > 50)) {
      invalidFields.push('dialogId');
    }
    const resourceRaw = args[1];
    const resourceDynamic = Boolean(resourceRaw && /<\$/i.test(resourceRaw));
    const resourceNumber = resourceDynamic ? undefined : parseInteger(resourceRaw);
    if (resourceDynamic) dynamicFields.push('resource');
    else if (!resourceRaw) invalidFields.push('resource');
    const imageIndex = numeric(2, 'backgroundImage');
    if (imageIndex !== undefined && imageIndex < 0) invalidFields.push('backgroundImage');
    const movable = binary(3, 'movable');
    const [windowX, windowY] = pair(4, 'windowOrigin');
    const [textOffsetX, textOffsetY] = pair(5, 'textOffset');
    const createPosition = numeric(6, 'createPosition');
    if (createPosition !== undefined && (createPosition < 0 || createPosition > 43)) {
      invalidFields.push('createPosition');
    }

    const contentStart = invocation.arguments[7]?.start;
    const inlineTail = contentStart === undefined ? '' : line.text.slice(contentStart);
    const inlineLeadingWhitespace = inlineTail.length - inlineTail.trimStart().length;
    const inlineContent = inlineTail.trim();
    const inlineAbsoluteStart = contentStart === undefined
      ? undefined
      : line.start + contentStart + inlineLeadingWhitespace;
    const inlineSourceRange = inlineAbsoluteStart !== undefined && inlineContent
      ? span(source, inlineAbsoluteStart, inlineAbsoluteStart + inlineContent.length)
      : undefined;
    let contentPreview: DialogAddDlgWindow['contentPreview'];
    if (command === 'ADDDLG') {
      const contentDynamic = Boolean(inlineContent && /<\$/i.test(inlineContent));
      if (contentDynamic) dynamicFields.push('content');
      else if (!inlineContent) invalidFields.push('content');
      contentPreview = {
        mode: 'inline',
        raw: inlineContent,
        status: contentDynamic ? 'dynamic' : inlineContent ? 'static' : 'invalid',
      };
    } else {
      const fileRaw = args[7] || '';
      const pathDynamic = Boolean(fileRaw && /<\$/i.test(fileRaw));
      if (pathDynamic) dynamicFields.push('content');
      else if (!fileRaw) invalidFields.push('content');
      const absolute = binary(8, 'absolute');
      const absoluteDynamic = Boolean(args[8] && /<\$/i.test(args[8]));
      const contentStatus = pathDynamic || absoluteDynamic
        ? 'dynamic'
        : (!fileRaw || absolute === undefined)
          ? 'invalid'
          : 'evidence-blocked';
      contentPreview = {
        mode: 'external-file',
        raw: fileRaw,
        ...(absolute !== undefined ? { absolute } : {}),
        status: contentStatus,
      };
      if (args.length > 9) invalidFields.push('extraParameters');
      warnings.push(
        `Evidence-blocked：ADDDLGEX 外部文件 ${fileRaw || '(未知)'} 的客户端解码、相对路径基准和生命周期未公开；Ctrl+F12 不读取、不加载也不执行该文件`
      );
    }

    const linkedCloseActions = closeActions.filter(action => (
      action.dynamic || (dialogId !== undefined && action.dialogId === dialogId)
    ));
    if (linkedCloseActions.some(action => action.scope === 'all-users')) {
      warnings.push('Runtime-boundary：DELDLG 全服用户范围只展示生命周期配置，Ctrl+F12 不会关闭任何真实客户端窗口');
    }
    if (linkedCloseActions.some(action => action.scopeDynamic)) {
      warnings.push('DELDLG 删除范围包含动态值，静态预览不借用 MOV 当前值，也不执行关闭');
    }
    if (linkedCloseActions.some(action => action.invalid)) {
      warnings.push('DELDLG 删除范围参数无效；只保留命令证据，不猜测自身或全服范围');
    }

    const uniqueDynamicFields = [...new Set(dynamicFields)];
    const uniqueInvalidFields = [...new Set(invalidFields)];
    if (uniqueDynamicFields.length > 0) {
      warnings.push(
        `${command} 的 ${uniqueDynamicFields.join('、')} 是动态/运行时字段，静态预览不借用 MOV 当前值`
      );
    }
    if (uniqueInvalidFields.length > 0) {
      warnings.push(`${command} 的 ${uniqueInvalidFields.join('、')} 参数无效或缺失，静态预览不猜测`);
    }
    warnings.push(
      `Partial simulation：只绘制 LFM ${command} 的静态几何和可确定内容；真实宿主附着、客户端移动与关闭属于运行时`
    );

    const absoluteStart = line.start + invocation.commandSpan.start;
    const absoluteEnd = line.start + (invocation.arguments.at(-1)?.end ?? invocation.commandSpan.end);
    const windowOriginBinding = createPairCoordinateBinding(
      source,
      line,
      invocation.arguments[4],
      windowX,
      windowY,
      'adddlg-window-origin',
      absoluteStart,
      sourceDocument
    );
    const contentOriginBinding = createPairCoordinateBinding(
      source,
      line,
      invocation.arguments[5],
      textOffsetX,
      textOffsetY,
      'adddlg-content-origin',
      absoluteStart,
      sourceDocument
    );
    const assetAllowed = imageIndex !== undefined
      && imageIndex >= 0
      && !resourceDynamic
      && Boolean(resourceRaw)
      && !uniqueInvalidFields.includes('backgroundImage');
    result.push({
      id: `${absoluteStart}:gee-${command.toLowerCase()}:${dialogId ?? result.length + 1}`,
      command,
      dialogId: dialogId !== undefined && dialogId >= 1 && dialogId <= 50 ? dialogId : undefined,
      raw: source.slice(absoluteStart, absoluteEnd),
      lineNumber: line.lineNumber + 1,
      sourceRange: span(source, absoluteStart, absoluteEnd),
      sourceUri: sourceDocument.uri,
      sourceFilePath: sourceDocument.filePath,
      sourceDocumentVersion: sourceDocument.documentVersion,
      ...(assetAllowed ? {
        assetRef: resourceNumber !== undefined
          ? { willIndex: resourceNumber, imageIndex: imageIndex! }
          : { archiveName: resourceRaw, imageIndex: imageIndex! },
      } : {}),
      movable,
      windowX,
      windowY,
      ...(windowOriginBinding ? { windowOriginBinding } : {}),
      textOffsetX,
      textOffsetY,
      ...(contentOriginBinding ? { contentOriginBinding } : {}),
      createPosition: createPosition !== undefined && createPosition >= 0 && createPosition <= 43
        ? createPosition
        : undefined,
      ...(createPosition !== undefined && createPosition >= 0 && createPosition <= 43
        ? { createPositionLabel: GEE_ADDDLG_CREATE_POSITION_LABELS[createPosition] || `位置 ${createPosition}` }
        : {}),
      contentPreview,
      ...(command === 'ADDDLG' && inlineSourceRange ? { contentSourceRange: inlineSourceRange } : {}),
      parentSyncMove: undefined,
      refreshCoordinates: undefined,
      groupId: 0,
      displayMode: 0,
      popupDirection: 0,
      closeOnLeave: false,
      closeDelayMs: 300,
      closeActions: linkedCloseActions.map(action => ({ ...action })),
      dynamicFields: uniqueDynamicFields,
      invalidFields: uniqueInvalidFields,
      warnings,
    });
  }
  return result;
}

function createGeeAddDlgScenes(
  windows: readonly DialogAddDlgWindow[],
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>
): DialogScene[] {
  return windows.map((window, index) => {
    let elements: DialogElement[] = [];
    let unsupportedStatements: string[] = [];
    const warnings = [...window.warnings];
    if (window.contentPreview?.mode === 'inline' && window.contentPreview.status === 'static') {
      const inlineMapping = materializeAddDlgInlineSource(window.contentPreview.raw);
      const inlineSource = inlineMapping.source;
      const inlineLines = scanScriptLines(inlineSource);
      const parsed = parseVisualElements(
        inlineSource,
        new Map(inlineLines.map(line => [line.lineNumber, line])),
        inlineLines,
        offsets,
        schemasByToken
      );
      elements = parsed.elements.map((element, elementIndex) => rebaseAddDlgInlineElement(
        element,
        elementIndex,
        window,
        inlineMapping
      ));
      unsupportedStatements = parsed.unsupported;
      warnings.push(...parsed.warnings);
      if (elements.some(element => [
        'item-box', 'input-number', 'input-text',
      ].includes(element.statementId))) {
        warnings.push('LFM 手册明确 ADDDLG 不支持 ITEMBOX、INPUTNUM、INPUTTEXT；相关内容仅保留评估边界');
      }
    }
    const dialogLabel = window.dialogId ?? index + 1;
    const sourceLabel = `@LFM-${window.command || 'ADDDLG'}-${dialogLabel}`;
    return {
      id: `${window.id}:scene`,
      title: `${sourceLabel} · 静态预览`,
      sourceLabel,
      marker: 'STATIC',
      conditions: [],
      conditionOperators: [],
      previewPath: {},
      conditionSummary: '默认界面',
      sourceStart: window.sourceRange.start,
      sourceEnd: window.sourceRange.end,
      addDlgWindow: window,
      elements,
      unsupportedStatements,
      warnings: [...new Set(warnings)],
      resolvedVariables: [],
    };
  });
}

interface AddDlgInlineSourceMapping {
  source: string;
  /** Synthetic-source boundary index -> physical inline-source boundary index. */
  physicalBoundaries: number[];
}

function materializeAddDlgInlineSource(physical: string): AddDlgInlineSourceMapping {
  let synthetic = '';
  const physicalBoundaries = [0];
  let physicalIndex = 0;
  while (physicalIndex < physical.length) {
    if (physical[physicalIndex] === '\\' && physical[physicalIndex + 1] === '\\') {
      synthetic += '\n';
      physicalIndex += 2;
      physicalBoundaries.push(physicalIndex);
      continue;
    }
    synthetic += physical[physicalIndex];
    physicalIndex++;
    physicalBoundaries.push(physicalIndex);
  }
  return { source: synthetic, physicalBoundaries };
}

function rebaseAddDlgInlineElement(
  element: DialogElement,
  elementIndex: number,
  window: DialogAddDlgWindow,
  mapping: AddDlgInlineSourceMapping
): DialogElement {
  const physicalRange = window.contentPreview?.mode === 'inline'
    ? window.contentSourceRange
    : undefined;
  if (!physicalRange) {
    return {
      ...element,
      id: `${window.id}:inline:${elementIndex}:${element.statementId}`,
      lineNumber: window.lineNumber,
      editable: false,
      warning: mergeWarningClauses(
        element.warning,
        'LFM ADDDLG 行内内容缺少物理源码范围，当前坐标只读'
      ),
    };
  }
  const rebaseSpan = (syntheticSpan: SourceSpan): SourceSpan => {
    const relativeStart = mapping.physicalBoundaries[syntheticSpan.start];
    const relativeEnd = mapping.physicalBoundaries[syntheticSpan.end];
    if (relativeStart === undefined || relativeEnd === undefined) {
      return physicalRange;
    }
    return {
      start: physicalRange.start + relativeStart,
      end: physicalRange.start + relativeEnd,
      original: physicalRange.original.slice(relativeStart, relativeEnd),
    };
  };
  const rebaseCoordinate = (value: DialogCoordinate | undefined): DialogCoordinate | undefined => (
    value ? {
      ...value,
      // The rebased coordinate describes the literal physical #ACT field.
      // Layout bias remains on the element itself and must not leak into the
      // source-bound Inspector value.
      displayValue: value.sourceValue,
      span: rebaseSpan(value.span),
    } : undefined
  );
  const sourceRange = rebaseSpan(element.sourceRange);
  const x = rebaseCoordinate(element.x);
  const y = rebaseCoordinate(element.y);
  const editable = Boolean(element.editable && x && y);
  return {
    ...element,
    id: `${window.id}:inline:${elementIndex}:${element.statementId}`,
    raw: sourceRange.original,
    lineNumber: window.lineNumber,
    sourceRange,
    ...(window.sourceUri ? { sourceUri: window.sourceUri } : {}),
    ...(window.sourceFilePath ? { sourceFilePath: window.sourceFilePath } : {}),
    ...(window.sourceDocumentVersion !== undefined
      ? { sourceDocumentVersion: window.sourceDocumentVersion }
      : {}),
    editable,
    x,
    y,
    warning: mergeWarningClauses(
      element.warning,
      editable
        ? 'LFM ADDDLG 行内内容已绑定到 #ACT 物理源码；直接数值坐标可安全编辑'
        : 'LFM ADDDLG 行内内容坐标不是可安全修改的直接数值'
    ),
  };
}

type AddButtonActionCommand = 'ADDBUTTON' | 'ADDBUTTONEX' | 'DELBUTTON';

interface AddButtonActionInvocation {
  sourceLabel: string;
  line: ScriptLine;
  command: AddButtonActionCommand;
  arguments: Array<{ start: number; end: number; text: string }>;
  commandStart: number;
  commandEnd: number;
}

interface AddButtonArchiveIdentity {
  willIndex?: number;
  archiveName?: string;
}

/**
 * ADDBUTTON is a #ACT-side client UI action, so it never reaches the regular
 * #SAY markup parser. Retain it as a local-only element on every scene from the
 * same reachable function. Literal coordinate spans remain independently
 * editable without executing the real client action.
 */
function attachAddButtonActionPreviews(
  source: string,
  sections: readonly ScriptFunctionSection[],
  scenes: DialogScene[],
  engine: EngineId,
  variableResolution: ReadonlyMap<string, DialogLabelVariableResolution>
): void {
  const invocations = collectAddButtonActionInvocations(sections, engine);
  if (invocations.length === 0) return;
  const deleteActions = invocations
    .filter(invocation => invocation.command === 'DELBUTTON')
    .map(invocation => parseAddButtonDeleteAction(invocation, engine));
  const parsed = invocations.flatMap((invocation, index) => {
    if (invocation.command === 'DELBUTTON') return [];
    const sourceElement = parseAddButtonCreation(source, invocation, engine, index);
    const element = bindAddButtonDisplayValues(
      sourceElement,
      invocation,
      engine,
      index,
      variableResolution.get(normalizeLabel(invocation.sourceLabel))?.lines.get(
        invocation.line.lineNumber
      )
    );
    const triggerId = element.addButtonPreview?.triggerId;
    if (element.addButtonPreview) {
      element.addButtonPreview.deleteActions = deleteActions
        .filter(action => action.dynamic || (
          triggerId !== undefined && action.buttonId === triggerId
        ))
        .map(action => ({ ...action }));
    }
    return [element];
  });
  if (parsed.length === 0) return;

  const byLabel = new Map<string, DialogElement[]>();
  for (const entry of parsed) {
    const label = invocations.find(invocation => (
      invocation.command !== 'DELBUTTON'
      && entry.sourceRange.start === invocation.line.start + invocation.commandStart
    ))?.sourceLabel;
    if (!label) continue;
    const key = normalizeLabel(label);
    const elements = byLabel.get(key) || [];
    elements.push(entry);
    byLabel.set(key, elements);
  }

  for (const section of sections) {
    const key = normalizeLabel(section.label);
    const elements = byLabel.get(key);
    if (!elements?.length) continue;
    const matchingScenes = scenes.filter(scene => normalizeLabel(scene.sourceLabel) === key);
    if (matchingScenes.length === 0) {
      scenes.push({
        id: `${key}:action-addbutton-static`,
        title: `${section.label} · #ACT 按钮静态预览`,
        sourceLabel: section.label,
        marker: 'STATIC',
        conditions: [],
        conditionOperators: [],
        previewPath: {},
        conditionSummary: '#ACT 按钮静态预览',
        sourceStart: section.start,
        sourceEnd: section.end,
        elements,
        unsupportedStatements: [],
        warnings: [...new Set(elements.map(element => element.warning).filter(
          (value): value is string => Boolean(value)
        ))],
        resolvedVariables: [],
      });
      continue;
    }
    for (const scene of matchingScenes) {
      scene.elements.push(...elements);
      scene.warnings.push(...elements.map(element => element.warning).filter(
        (value): value is string => Boolean(value)
      ));
      scene.warnings = [...new Set(scene.warnings)];
    }
  }
}

function bindAddButtonDisplayValues(
  sourceElement: DialogElement,
  invocation: AddButtonActionInvocation,
  engine: EngineId,
  ordinal: number,
  resolution: DialogResolvedLine | undefined
): DialogElement {
  if (!resolution || resolution.text === invocation.line.text || !/<\$/i.test(sourceElement.raw)) {
    return sourceElement;
  }
  const resolved = findScriptCommandInvocations(resolution.text, typedName => {
    if (/^ADDBUTTONEX$/i.test(typedName) && engine !== 'GEE') return 'ADDBUTTONEX' as const;
    if (/^ADDBUTTON$/i.test(typedName)) return 'ADDBUTTON' as const;
    return undefined;
  }).find(candidate => candidate.form === 'line' && candidate.command === invocation.command);
  if (!resolved) return sourceElement;
  const resolvedLine: ScriptLine = {
    text: resolution.text,
    start: 0,
    end: resolution.text.length,
    fullEnd: resolution.text.length,
    lineNumber: invocation.line.lineNumber,
  };
  const evaluated = parseAddButtonCreation(resolution.text, {
    sourceLabel: invocation.sourceLabel,
    line: resolvedLine,
    command: resolved.command,
    arguments: resolved.arguments.map(argument => ({ ...argument })),
    commandStart: resolved.commandSpan.start,
    commandEnd: resolved.commandSpan.end,
  }, engine, ordinal);
  const sourceCaption = addButtonDisplayExpressions(invocation);
  let result = sourceElement;
  const additions: Array<DialogDisplayValueSource | undefined> = [];
  if (sourceCaption.title && /<\$/i.test(sourceCaption.title) && evaluated.textPreview) {
    const textPreview = cloneDialogTextPreview(evaluated.textPreview);
    const text = textPreview.lines.map(line => line.map(run => run.text).join('')).join('\n')
      || '预览文字';
    result = {
      ...result,
      text,
      textPreview,
    };
    additions.push(displayValueSource(
      'addbutton-title',
      'text',
      sourceCaption.title,
      text,
      resolution.variables
    ));
  }
  if (sourceCaption.tooltip && /<\$/i.test(sourceCaption.tooltip) && evaluated.tooltipPreview) {
    const tooltipPreview: DialogTooltipPreview = {
      ...evaluated.tooltipPreview,
      raw: sourceCaption.tooltip,
      lines: evaluated.tooltipPreview.lines.map(line => line.map(run => ({ ...run }))),
    };
    const text = tooltipPreview.lines
      .map(line => line.map(run => run.text).join(''))
      .join('\n') || '预览文字';
    result = { ...result, tooltipPreview };
    additions.push(displayValueSource(
      'addbutton-tooltip',
      'text',
      sourceCaption.tooltip,
      text,
      resolution.variables
    ));
  }
  const displayValueSources = mergeDisplayValueSources(
    result.displayValueSources,
    additions
  );
  return {
    ...result,
    raw: sourceElement.raw,
    sourceRange: sourceElement.sourceRange,
    ...(displayValueSources ? { displayValueSources } : {}),
  };
}

function addButtonDisplayExpressions(
  invocation: AddButtonActionInvocation
): { title?: string; tooltip?: string } {
  if (invocation.command === 'ADDBUTTONEX') {
    const [title, tooltip] = splitAddButtonPacked(invocation.arguments[7]?.text);
    return { title, tooltip };
  }
  return {
    title: invocation.arguments[8]?.text,
    tooltip: invocation.arguments[9]?.text,
  };
}

function collectAddButtonActionInvocations(
  sections: readonly ScriptFunctionSection[],
  engine: EngineId
): AddButtonActionInvocation[] {
  const result: AddButtonActionInvocation[] = [];
  for (const section of sections) {
    let actionContext = false;
    for (const line of section.lines.slice(1)) {
      const directive = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)\b/i.exec(line.text)?.[1]
        ?.toUpperCase();
      if (directive) actionContext = directive === 'ACT' || directive === 'ELSEACT';
      if (!actionContext) continue;
      const invocation = findScriptCommandInvocations(line.text, typedName => {
        if (/^DELBUTTON$/i.test(typedName)) return 'DELBUTTON' as const;
        if (/^ADDBUTTONEX$/i.test(typedName) && engine !== 'GEE') return 'ADDBUTTONEX' as const;
        if (/^ADDBUTTON$/i.test(typedName)) return 'ADDBUTTON' as const;
        return undefined;
      }).find(candidate => candidate.form === 'line');
      if (!invocation) continue;
      result.push({
        sourceLabel: section.label,
        line,
        command: invocation.command,
        arguments: invocation.arguments.map(argument => ({ ...argument })),
        commandStart: invocation.commandSpan.start,
        commandEnd: invocation.commandSpan.end,
      });
    }
  }
  return result;
}

interface ActUiActionInvocation {
  sourceLabel: string;
  line: ScriptLine;
  command: DialogActUiCommand;
  arguments: Array<{ start: number; end: number; text: string }>;
  commandStart: number;
  commandEnd: number;
}

const ACT_UI_COMMANDS = new Map<string, DialogActUiCommand>([
  ['MESSAGEBOX', 'messagebox'],
  ['SHOWPROGRESSBARDLG', 'show-progress-bar'],
  ['PLAYWINDOWEFFECT', 'play-window-effect'],
  ['SENDMOVEHINTMSG', 'send-move-hint'],
  ['OPENUPGRADEDLG', 'open-upgrade-dialog'],
  ['OPENCLIENTDLG', 'open-client-dialog'],
]);

function collectActUiPreviews(
  source: string,
  sections: readonly ScriptFunctionSection[],
  engine: EngineId,
  variableResolution: ReadonlyMap<string, DialogLabelVariableResolution>
): DialogActUiPreview[] {
  const invocations: ActUiActionInvocation[] = [];
  for (const section of sections) {
    let actionContext = false;
    for (const line of section.lines.slice(1)) {
      const directive = /^\s*#(IF|OR|AND|ACT|ELSEACT|SAY|ELSESAY)\b/i.exec(line.text)?.[1]
        ?.toUpperCase();
      if (directive) actionContext = directive === 'ACT' || directive === 'ELSEACT';
      if (!actionContext) continue;
      const invocation = findScriptCommandInvocations(line.text, typedName => (
        ACT_UI_COMMANDS.get(typedName.toUpperCase())
      )).find(candidate => candidate.form === 'line');
      if (!invocation) continue;
      invocations.push({
        sourceLabel: section.label,
        line,
        command: invocation.command,
        arguments: invocation.arguments.map(argument => ({ ...argument })),
        commandStart: invocation.commandSpan.start,
        commandEnd: invocation.commandSpan.end,
      });
    }
  }
  return invocations
    .sort((left, right) => (
      left.line.start + left.commandStart - right.line.start - right.commandStart
    ))
    .map((invocation, index) => {
      const resolution = variableResolution
        .get(normalizeLabel(invocation.sourceLabel))
        ?.lines.get(invocation.line.lineNumber);
      const evaluatedInvocation = resolution
        ? actUiEvaluatedInvocation(invocation, resolution)
        : invocation;
      return parseActUiPreview(source, invocation, engine, index, {
        invocation: evaluatedInvocation,
        variables: resolution?.variables || [],
      });
    });
}

interface ActUiDisplayEvaluation {
  invocation: ActUiActionInvocation;
  variables: readonly DialogResolvedVariable[];
}

function actUiEvaluatedInvocation(
  sourceInvocation: ActUiActionInvocation,
  resolution: DialogResolvedLine
): ActUiActionInvocation {
  const parsed = findScriptCommandInvocations(resolution.text, typedName => (
    ACT_UI_COMMANDS.get(typedName.toUpperCase())
  )).find(candidate => (
    candidate.form === 'line' && candidate.command === sourceInvocation.command
  ));
  if (!parsed) return sourceInvocation;
  return {
    ...sourceInvocation,
    line: { ...sourceInvocation.line, text: resolution.text },
    arguments: parsed.arguments.map(argument => ({ ...argument })),
    commandStart: parsed.commandSpan.start,
    commandEnd: parsed.commandSpan.end,
  };
}

function parseActUiPreview(
  source: string,
  invocation: ActUiActionInvocation,
  engine: EngineId,
  index: number,
  displayEvaluation?: ActUiDisplayEvaluation
): DialogActUiPreview {
  const args = invocation.arguments.map(argument => argument.text);
  let fields: DialogActUiField[] = [];
  let evidenceStatus: DialogActUiPreview['evidenceStatus'];
  let warning = 'Partial simulation：仅本地展示，不执行服务器标签、客户端窗口、宿主动作或导航';
  switch (invocation.command) {
    case 'messagebox': {
      const parts = actUiMessageBoxParts(invocation);
      fields = [actUiTextField('message', parts.message)];
      if (parts.confirmLabel) {
        fields.push(actUiTextField('confirm-label', parts.confirmLabel));
      }
      if (parts.cancelLabel) {
        fields.push(actUiTextField('cancel-label', parts.cancelLabel));
      }
      warning = 'Partial simulation：MessageBox 文字与按钮标签仅展示，不执行 @ 标签或创建真实客户端窗口';
      break;
    }
    case 'show-progress-bar': {
      // Find the documented interruption label first, then classify the
      // preceding switch. Requiring the switch to already be 0/1 would swallow
      // dynamic or invalid source into the message and hide its uncertainty.
      const interruptLabelIndex = args.findIndex((value, argumentIndex) => (
        argumentIndex >= 3 && /^@\S+/u.test(value)
      ));
      const interruptIndex = interruptLabelIndex >= 0 ? interruptLabelIndex - 1 : -1;
      const textEnd = interruptIndex >= 0 ? interruptIndex : args.length;
      fields = [
        actUiIntegerField('duration-seconds', args[0], { minimum: 0 }),
        actUiTextField('complete-label', args[1]),
        actUiTextField('message', args.slice(2, textEnd).join(' ')),
      ];
      const extraStart = interruptLabelIndex >= 0 ? interruptLabelIndex + 1 : textEnd;
      if (interruptIndex >= 0) {
        fields.push(
          actUiBooleanField('interrupt-mode', args[interruptIndex]),
          actUiTextField('interrupt-label', args[interruptLabelIndex])
        );
      }
      if (engine === 'GEE' && args.length > extraStart) {
        const extra = args.slice(extraStart);
        fields.push(actUiBooleanField('custom-ui-enabled', extra[0]));
        if (extra[1]) fields.push(actUiTextField('progress-archive', extra[1]));
        if (extra[2]) fields.push(actUiIntegerField('progress-image', extra[2], { minimum: 0 }));
        if (extra[3]) fields.push(actUiTextField('text-archive', extra[3]));
        if (extra[4]) fields.push(actUiIntegerField('text-image', extra[4], { minimum: 0 }));
        fields.push(
          actUiPairField('text-offset-candidate', extra[5], 'evidence-blocked'),
          actUiPairField('progress-offset-candidate', extra[6], 'evidence-blocked')
        );
        evidenceStatus = 'evidence-blocked';
        warning = 'Partial simulation / Evidence-blocked：GEE/LFM 帮助对文字与进度偏移顺序自相矛盾；保留两个候选，不应用几何，也不执行完成或中断标签';
      } else {
        warning = 'Partial simulation：采集进度仅静态展示，不会计时完成，不执行完成或中断标签';
      }
      if (engine === '996PC') evidenceStatus = 'evidence-blocked';
      break;
    }
    case 'play-window-effect': {
      if (engine === 'GEE') {
        fields = actUiUnverifiedArgumentFields(args);
        evidenceStatus = 'evidence-blocked';
        warning = 'Partial simulation / Evidence-blocked：本地 GEE/LFM 手册未找到 PlayWindowEffect 参数合同；仅保留原始参数，不借用 GOM/996PC 语义，不播放特效';
      } else {
        fields = [
          actUiIntegerField('target-window', args[0], { minimum: 0, maximum: 9 }),
          actUiIntegerField('effect-type', args[1], { minimum: 0, maximum: 7 }),
          actUiIntegerField('will-index', args[2], { minimum: 0 }),
          actUiIntegerField('start-image', args[3], { minimum: 0 }),
          actUiIntegerField('end-image', args[4], { minimum: 0 }),
          actUiIntegerField('interval-ms', args[5], { minimum: 0 }),
          actUiIntegerField('repeat-count', args[6], { minimum: 0 }),
          actUiCombinedPairField('offset', args[7], args[8]),
          actUiDrawModeField(args[9]),
        ];
        if (engine === '996PC') evidenceStatus = 'evidence-blocked';
        warning = 'Partial simulation：窗口特效参数仅展示，不附着真实客户端窗口，不加载或播放推测动画';
      }
      break;
    }
    case 'send-move-hint': {
      if (engine === '996PC') {
        fields = actUiUnverifiedArgumentFields(args);
        evidenceStatus = 'evidence-blocked';
        warning = 'Partial simulation / Evidence-blocked：本地 996PC 手册未找到 SENDMOVEHINTMSG 参数合同；仅保留原始参数，不借用 GOM 或 GEE/LFM 的第 6 参数语义';
        break;
      }
      const fixedTail = actUiSendMoveHintTailLength(args);
      const messageEnd = Math.max(1, args.length - fixedTail);
      const tail = args.slice(messageEnd);
      fields = [
        actUiTextField('message', args.slice(0, messageEnd).join(' ')),
        actUiIntegerField('font-color', tail[0], { minimum: 0 }),
        actUiIntegerField('background-color', tail[1], { minimum: 0 }),
        actUiIntegerField('x', tail[2]),
        actUiIntegerField('y', tail[3]),
      ];
      if (engine === 'GOM') {
        fields.push(
          actUiConstantField('parameter-6-semantics', 'screen-coordinate-mode'),
          actUiBooleanField('screen-coordinate-mode', tail[4])
        );
      } else {
        fields.push(actUiConstantField('parameter-6-semantics', 'duration-seconds'));
        const duration = tail[4] === undefined
          ? actUiConstantField('duration-seconds', 3)
          : actUiIntegerField('duration-seconds', tail[4], { minimum: 0 });
        if (duration.status === 'static' && duration.value === 0) duration.value = 3;
        fields.push(duration);
      }
      warning = 'Partial simulation：滚动提示仅静态展示，不创建客户端滚动动画；第 6 参数按当前引擎隔离解释';
      break;
    }
    case 'open-upgrade-dialog':
      fields = [
        actUiTextField('title', args.join(' ')),
        { name: 'item-slot', status: 'evidence-blocked' },
      ];
      warning = 'Partial simulation / Runtime-data blocked：仅展示升级标题；不伪造玩家物品槽，不执行 @UpgradeDlgItem';
      break;
    case 'open-client-dialog': {
      if (engine === '996PC') {
        fields = actUiUnverifiedArgumentFields(args);
        evidenceStatus = 'evidence-blocked';
        warning = 'Partial simulation / Evidence-blocked：本地 996PC 手册未找到 OPENCLIENTDLG 窗口 ID 与坐标合同；仅保留原始参数，不借用 GEE/LFM 窗口名称';
        break;
      }
      const dialogId = actUiIntegerField('dialog-id', args[0], { minimum: 0 });
      fields = [dialogId];
      if (dialogId.status === 'static' && typeof dialogId.value === 'number') {
        const dialogName = actUiClientDialogName(engine, dialogId.value);
        if (dialogName) fields.push(actUiConstantField('dialog-name', dialogName));
      }
      fields.push(actUiIntegerField('coordinate-mode', args[1], {
        allowed: engine === 'GOM' ? [0, 1, 2] : [0, 1],
      }));
      if (args[2] !== undefined || args[3] !== undefined) {
        fields.push(actUiCombinedPairField('coordinate', args[2], args[3]));
      }
      if (args[4] !== undefined || args[5] !== undefined) {
        if (engine === 'GOM' && dialogId.status === 'static' && dialogId.value === 19) {
          fields.push(actUiIntegerField('map-id', args[4]));
          if (args[5] !== undefined) {
            fields.push(actUiTextField('map-name', args.slice(5).join(' ')));
          }
        } else {
          fields.push(actUiUnverifiedArgumentField(
            'dialog-specific-extra-parameters',
            args.slice(4)
          ));
          evidenceStatus = 'evidence-blocked';
        }
      }
      warning = 'Partial simulation：客户端窗口 ID 与坐标仅展示，不打开、关闭或导航真实客户端窗口';
      break;
    }
  }

  if (displayEvaluation) {
    const evaluatedFields = parseActUiPreview(
      source,
      displayEvaluation.invocation,
      engine,
      index
    ).fields;
    fields = bindActUiDisplayValues(
      invocation.command,
      fields,
      evaluatedFields,
      displayEvaluation.variables
    );
  }

  const dynamicFields = fields.filter(field => field.status === 'dynamic').map(field => field.name);
  const invalidFields = fields.filter(field => field.status === 'invalid').map(field => field.name);
  const start = invocation.line.start + invocation.commandStart;
  const end = invocation.line.start + (
    invocation.arguments.at(-1)?.end ?? invocation.commandEnd
  );
  return {
    id: `ACTUI:${start}:${index}`,
    command: invocation.command,
    sourceLabel: invocation.sourceLabel,
    lineNumber: invocation.line.lineNumber + 1,
    sourceRange: span(source, start, end),
    fields,
    simulation: 'partial',
    localOnly: true,
    ...(evidenceStatus ? { evidenceStatus } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    warning,
  };
}

function bindActUiDisplayValues(
  command: DialogActUiCommand,
  sourceFields: readonly DialogActUiField[],
  evaluatedFields: readonly DialogActUiField[],
  variables: readonly DialogResolvedVariable[]
): DialogActUiField[] {
  const displayTextFields = actUiDisplayTextFieldNames(command);
  const evaluatedByName = new Map(evaluatedFields.map(field => [field.name, field]));
  return sourceFields.map(field => {
    if (!displayTextFields.has(field.name)) return field;
    const expression = field.raw ?? (typeof field.value === 'string' ? field.value : undefined);
    if (expression === undefined) return field;
    const evaluated = evaluatedByName.get(field.name);
    let value = typeof evaluated?.value === 'string' ? evaluated.value : undefined;
    const status = field.status === 'invalid'
      ? 'invalid-static'
      : runtimeExpressionStatus(expression, variables);
    if (value === undefined && status === 'runtime-placeholder') {
      value = /^@/u.test(expression) ? '@预览文字' : '预览文字';
    }
    if (value === undefined) return field;
    const variableNames = runtimeVariableNamesInText(expression);
    return {
      ...field,
      displayValueSource: {
        field: `act-ui.${command}.${field.name}`,
        kind: 'text',
        expression,
        status,
        value,
        ...(variableNames.length > 0 ? { variableNames } : {}),
      },
    };
  });
}

function actUiDisplayTextFieldNames(command: DialogActUiCommand): ReadonlySet<string> {
  switch (command) {
    case 'messagebox':
      return new Set(['message', 'confirm-label', 'cancel-label']);
    case 'show-progress-bar':
      return new Set(['complete-label', 'message', 'interrupt-label']);
    case 'send-move-hint':
      return new Set(['message']);
    case 'open-upgrade-dialog':
      return new Set(['title']);
    case 'open-client-dialog':
      return new Set(['map-name']);
    default:
      return new Set();
  }
}

function actUiMessageBoxParts(invocation: ActUiActionInvocation): {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
} {
  const first = invocation.arguments[0]?.start;
  const last = invocation.arguments.at(-1)?.end;
  const raw = first !== undefined && last !== undefined
    ? invocation.line.text.slice(first, last).trim()
    : '';
  // 996PC documents a compact color form where the confirm label is attached
  // directly to the message (`...}@confirm @cancel`). Parse from the raw tail
  // so whitespace tokenization does not merge that label into the message.
  const pair = /(@[^\s@]+)\s+(@[^\s@]+)\s*$/u.exec(raw);
  if (pair) {
    return {
      message: raw.slice(0, pair.index).trim(),
      confirmLabel: pair[1],
      cancelLabel: pair[2],
    };
  }
  const content = invocation.arguments.map(argument => argument.text);
  const labels: string[] = [];
  while (content.length > 0 && labels.length < 2 && /^@\S+/u.test(content.at(-1)!)) {
    labels.unshift(content.pop()!);
  }
  return {
    message: content.join(' '),
    ...(labels[0] ? { confirmLabel: labels[0] } : {}),
    ...(labels[1] ? { cancelLabel: labels[1] } : {}),
  };
}

function actUiUnverifiedArgumentFields(args: readonly string[]): DialogActUiField[] {
  return args.map((raw, index) => (
    actUiUnverifiedArgumentField(`parameter-${index + 1}`, [raw])
  ));
}

function actUiUnverifiedArgumentField(
  name: string,
  values: readonly string[]
): DialogActUiField {
  const raw = values.join(' ').trim();
  if (/<\$/i.test(raw)) return { name, status: 'dynamic', raw };
  return {
    name,
    status: 'evidence-blocked',
    ...(raw ? { raw, value: [...values] } : {}),
  };
}

function actUiDrawModeField(raw: string | undefined): DialogActUiField {
  const field = actUiTextField('draw-mode', raw);
  if (field.status !== 'static') return field;
  if (/^[01]\s*\|\s*[01]$/u.test(String(field.value))) return field;
  return { name: 'draw-mode', status: 'invalid', ...(raw !== undefined ? { raw } : {}) };
}

function actUiSendMoveHintTailLength(args: readonly string[]): number {
  const available = Math.max(0, args.length - 1);
  if (available <= 4) return available;
  // Only claim parameter 6 when the four preceding tokens can still be the
  // mandatory numeric fields. This keeps a multi-word message plus the four
  // required parameters from being shifted just because it also has six
  // whitespace tokens. Dynamic source is possible here but stays unresolved.
  const possibleMandatory = args.slice(-5, -1).every(value => (
    /<\$/i.test(value) || parseInteger(value) !== undefined
  ));
  return possibleMandatory ? 5 : 4;
}

function actUiTextField(name: string, raw: string | undefined): DialogActUiField {
  const value = raw?.trim();
  if (!value) return { name, status: 'invalid', ...(raw !== undefined ? { raw } : {}) };
  if (/<\$/i.test(value)) return { name, status: 'dynamic', raw: value };
  return { name, status: 'static', raw: value, value };
}

function actUiIntegerField(
  name: string,
  raw: string | undefined,
  options: { minimum?: number; maximum?: number; allowed?: readonly number[] } = {}
): DialogActUiField {
  const text = raw?.trim();
  if (!text) return { name, status: 'invalid', ...(raw !== undefined ? { raw } : {}) };
  if (/<\$/i.test(text)) return { name, status: 'dynamic', raw: text };
  const value = parseInteger(text);
  const valid = value !== undefined
    && (options.minimum === undefined || value >= options.minimum)
    && (options.maximum === undefined || value <= options.maximum)
    && (!options.allowed || options.allowed.includes(value));
  return valid
    ? { name, status: 'static', raw: text, value }
    : { name, status: 'invalid', raw: text };
}

function actUiBooleanField(name: string, raw: string | undefined): DialogActUiField {
  const field = actUiIntegerField(name, raw, { allowed: [0, 1] });
  if (field.status === 'static') field.value = field.value === 1;
  return field;
}

function actUiConstantField(name: string, value: string | number | boolean): DialogActUiField {
  return { name, status: 'static', value };
}

function actUiPairField(
  name: string,
  raw: string | undefined,
  forcedStatus?: 'evidence-blocked'
): DialogActUiField {
  const text = raw?.trim();
  if (!text) return { name, status: forcedStatus || 'invalid' };
  if (/<\$/i.test(text)) return { name, status: 'dynamic', raw: text };
  const match = /^([+-]?\d+)\s*,\s*([+-]?\d+)$/u.exec(text);
  if (!match) return { name, status: 'invalid', raw: text };
  return {
    name,
    status: forcedStatus || 'static',
    raw: text,
    value: [Number(match[1]), Number(match[2])],
  };
}

function actUiCombinedPairField(
  name: string,
  left: string | undefined,
  right: string | undefined
): DialogActUiField {
  if (/<\$/i.test(`${left || ''}${right || ''}`)) {
    return { name, status: 'dynamic', raw: [left, right].filter(Boolean).join(',') };
  }
  const x = parseInteger(left);
  const y = parseInteger(right);
  return x !== undefined && y !== undefined
    ? { name, status: 'static', raw: `${left},${right}`, value: [x, y] }
    : { name, status: 'invalid', raw: [left, right].filter(Boolean).join(',') };
}

function actUiClientDialogName(engine: EngineId, id: number): string {
  const gom = new Map<number, string>([
    [1, '系统商铺'], [2, '个人商店'], [3, '任务'], [4, '日志'],
    [5, '小地图'], [6, '交易'], [7, '行会'], [8, '组队'], [9, '关系'],
    [10, '帮助'], [11, '排行榜'], [12, '挑战'], [13, '私聊信息'], [14, '属性点分配'],
    [15, '背包'], [16, '装备栏'], [17, '技能栏'], [19, '大地图'],
    [28, '生肖盒'], [29, '对方生肖盒'], [30, '首饰盒'], [31, '对方首饰盒'],
  ]);
  const gee = new Map<number, string>([
    [1, '系统商铺'], [2, '个人商店'], [3, '任务'], [4, '日志'],
    [5, '小地图'], [6, '交易'], [7, '行会'], [8, '组队'], [9, '关系'],
    [10, '帮助'], [11, '排行榜'], [12, '挑战'], [13, '私聊信息'], [14, '属性点分配'],
    [15, '内挂'], [16, 'M地图'], [17, '背包'],
  ]);
  return (engine === 'GOM' ? gom : gee).get(id) || `未公开窗口 ${id}`;
}

function parseAddButtonDeleteAction(
  invocation: AddButtonActionInvocation,
  engine: EngineId
): DialogAddButtonDeleteAction {
  const rawId = invocation.arguments[0]?.text;
  const rawScope = invocation.arguments[1]?.text;
  const dynamic = Boolean(rawId && /<\$/i.test(rawId));
  const parsedId = dynamic ? undefined : parseInteger(rawId);
  const maximum = engine === 'GEE' ? 200 : 100;
  const idValid = parsedId !== undefined && parsedId >= 1 && parsedId <= maximum;
  const scopeDynamic = Boolean(rawScope && /<\$/i.test(rawScope));
  const parsedScope = scopeDynamic || rawScope === undefined ? undefined : parseInteger(rawScope);
  const scopeValid = rawScope === undefined || parsedScope === 0 || parsedScope === 1;
  return {
    ...(idValid ? { buttonId: parsedId } : {}),
    sourceLabel: invocation.sourceLabel,
    lineNumber: invocation.line.lineNumber + 1,
    dynamic,
    ...(scopeDynamic ? { scopeDynamic: true } : {}),
    ...(!scopeDynamic && scopeValid
      ? { scope: parsedScope === 1 ? 'all-users' as const : 'self' as const }
      : {}),
    ...(!dynamic && (!idValid || !scopeValid) ? { invalid: true } : {}),
  };
}

function parseAddButtonCreation(
  source: string,
  invocation: AddButtonActionInvocation,
  engine: EngineId,
  ordinal: number
): DialogElement {
  if (engine === '996PC' && invocation.command === 'ADDBUTTONEX') {
    return evidenceBlocked996AddButtonEx(source, invocation, ordinal);
  }
  return invocation.command === 'ADDBUTTONEX'
    ? parseGomAddButtonEx(source, invocation, ordinal)
    : parseLegacyAddButton(source, invocation, engine, ordinal);
}

function parseLegacyAddButton(
  source: string,
  invocation: AddButtonActionInvocation,
  engine: EngineId,
  ordinal: number
): DialogElement {
  const dynamicFields: string[] = [];
  const invalidFields: string[] = [];
  const raw = (index: number): string | undefined => invocation.arguments[index]?.text;
  const triggerMaximum = engine === 'GEE' ? 200 : 100;
  const archive = parseAddButtonArchive(raw(0), 'archive', dynamicFields, invalidFields, engine === 'GOM');
  const triggerId = parseAddButtonInteger(
    raw(1), 'trigger-id', dynamicFields, invalidFields, 1, triggerMaximum
  );
  const normal = parseAddButtonInteger(raw(2), 'normal-image', dynamicFields, invalidFields, 0);
  const hover = parseAddButtonInteger(raw(3), 'hover-image', dynamicFields, invalidFields, 0);
  const pressed = parseAddButtonInteger(raw(4), 'pressed-image', dynamicFields, invalidFields, 0);
  const x = parseAddButtonInteger(raw(5), 'x', dynamicFields, invalidFields);
  const y = parseAddButtonInteger(raw(6), 'y', dynamicFields, invalidFields);
  let movable: boolean | undefined;
  let groupId: number | undefined;
  let createPosition: number | undefined;
  let createPositionLabel: string | undefined;

  if (engine === 'GOM') {
    const parts = splitAddButtonPacked(raw(7));
    const movableValue = parseAddButtonInteger(
      parts[0], 'movable', dynamicFields, invalidFields, 0, 1
    );
    const groupValue = parseAddButtonInteger(
      parts[1], 'group', dynamicFields, invalidFields, 0, 10
    );
    groupId = groupValue === 0 ? undefined : groupValue;
    movable = movableValue === undefined ? undefined : movableValue === 1;
  } else if (engine === 'GEE') {
    createPosition = parseAddButtonInteger(
      raw(7), 'create-position', dynamicFields, invalidFields, 0, 43
    );
    if (createPosition !== undefined) {
      createPositionLabel = GEE_ADDDLG_CREATE_POSITION_LABELS[createPosition]
        || `位置 ${createPosition}`;
      if (createPosition === 1) movable = true;
    }
  } else {
    const movableValue = parseAddButtonInteger(
      raw(7), 'movable', dynamicFields, invalidFields, 0, 1
    );
    movable = movableValue === undefined ? undefined : movableValue === 1;
  }

  const title = parseAddButtonText(raw(8), 'title', dynamicFields, invalidFields, true);
  const tooltipRaw = parseAddButtonText(raw(9), 'tooltip', dynamicFields, invalidFields, false);
  const uniqueDynamic = [...new Set(dynamicFields)];
  const uniqueInvalid = [...new Set(invalidFields)];
  const status = addButtonStatus(uniqueDynamic, uniqueInvalid);
  const assetsAllowed = status === 'partial-simulation'
    && archive !== undefined
    && normal !== undefined
    && hover !== undefined
    && pressed !== undefined;
  const assetRef = assetsAllowed ? addButtonAssetReference(archive!, normal!) : undefined;
  const assetLayers = assetsAllowed ? [
    { role: 'hover' as const, assetRef: addButtonAssetReference(archive!, hover!) },
    { role: 'pressed' as const, assetRef: addButtonAssetReference(archive!, pressed!) },
  ] : undefined;
  const warning = addButtonWarning(invocation.command, engine, status, uniqueDynamic, uniqueInvalid);
  return buildAddButtonElement(source, invocation, ordinal, {
    engine,
    status,
    triggerId,
    movable,
    groupId,
    createPosition,
    createPositionLabel,
    x,
    y,
    xArgument: invocation.arguments[5],
    yArgument: invocation.arguments[6],
    title,
    tooltipRaw,
    assetRef,
    assetLayers,
    effects: [],
    dynamicFields: uniqueDynamic,
    invalidFields: uniqueInvalid,
    warning,
  });
}

function parseGomAddButtonEx(
  source: string,
  invocation: AddButtonActionInvocation,
  ordinal: number
): DialogElement {
  const dynamicFields: string[] = [];
  const invalidFields: string[] = [];
  const raw = (index: number): string | undefined => invocation.arguments[index]?.text;
  const base = splitAddButtonPacked(raw(0));
  const triggerId = parseAddButtonInteger(base[0], 'trigger-id', dynamicFields, invalidFields, 1, 100);
  const x = parseAddButtonInteger(base[1], 'x', dynamicFields, invalidFields);
  const y = parseAddButtonInteger(base[2], 'y', dynamicFields, invalidFields);
  const movableValue = parseAddButtonInteger(base[3], 'movable', dynamicFields, invalidFields, 0, 1);
  const movable = movableValue === undefined ? undefined : movableValue === 1;
  const groupValue = parseAddButtonInteger(base[4], 'group', dynamicFields, invalidFields, 0, 10);
  const groupId = groupValue === 0 ? undefined : groupValue;
  const archive = parseAddButtonArchive(raw(1), 'archive', dynamicFields, invalidFields, true);
  const images = splitAddButtonPacked(raw(2));
  const normal = parseAddButtonInteger(images[0], 'normal-image', dynamicFields, invalidFields, 0);
  const hover = parseAddButtonInteger(images[1], 'hover-image', dynamicFields, invalidFields, 0);
  const pressed = parseAddButtonInteger(images[2], 'pressed-image', dynamicFields, invalidFields, 0);
  const effectArchive = parseAddButtonArchive(
    raw(3), 'effect-archive', dynamicFields, invalidFields, true
  );
  const effects = (['normal', 'hover', 'pressed'] as const).flatMap((state, index) => {
    const effect = raw(4 + index);
    return effect === '*'
      ? []
      : [parseAddButtonEffect(state, effect, effectArchive, dynamicFields, invalidFields)];
  });
  const caption = splitAddButtonPacked(raw(7));
  const title = parseAddButtonText(caption[0], 'title', dynamicFields, invalidFields, true);
  const tooltipRaw = parseAddButtonText(caption[1], 'tooltip', dynamicFields, invalidFields, false);
  const createPosition = parseAddButtonInteger(
    raw(8), 'create-position', dynamicFields, invalidFields, 0, ADDDLG_CREATE_POSITION_LABELS.length - 1
  );
  const createPositionLabel = createPosition === undefined
    ? undefined
    : ADDDLG_CREATE_POSITION_LABELS[createPosition] || `位置 ${createPosition}`;
  const uniqueDynamic = [...new Set(dynamicFields)];
  const uniqueInvalid = [...new Set(invalidFields)];
  const status = addButtonStatus(uniqueDynamic, uniqueInvalid);
  const assetsAllowed = status === 'partial-simulation'
    && archive !== undefined
    && normal !== undefined
    && hover !== undefined
    && pressed !== undefined;
  const hydratedEffects = status === 'partial-simulation'
    ? effects
    : effects.map(effect => ({ ...effect, assetRef: undefined }));
  return buildAddButtonElement(source, invocation, ordinal, {
    engine: 'GOM',
    status,
    triggerId,
    movable,
    groupId,
    createPosition,
    createPositionLabel,
    x,
    y,
    xArgument: addButtonPackedArgumentPart(invocation.arguments[0], 1),
    yArgument: addButtonPackedArgumentPart(invocation.arguments[0], 2),
    title,
    tooltipRaw,
    assetRef: assetsAllowed ? addButtonAssetReference(archive!, normal!) : undefined,
    assetLayers: assetsAllowed ? [
      { role: 'hover' as const, assetRef: addButtonAssetReference(archive!, hover!) },
      { role: 'pressed' as const, assetRef: addButtonAssetReference(archive!, pressed!) },
    ] : undefined,
    effects: hydratedEffects,
    dynamicFields: uniqueDynamic,
    invalidFields: uniqueInvalid,
    warning: addButtonWarning(
      invocation.command, 'GOM', status, uniqueDynamic, uniqueInvalid, true
    ),
  });
}

function parseAddButtonEffect(
  state: DialogAddButtonEffectPreview['state'],
  raw: string | undefined,
  archive: AddButtonArchiveIdentity | undefined,
  dynamicFields: string[],
  invalidFields: string[]
): DialogAddButtonEffectPreview {
  const fields = splitAddButtonPacked(raw);
  const prefix = `${state}-effect`;
  const imageIndex = parseAddButtonInteger(
    fields[0], `${prefix}-image`, dynamicFields, invalidFields, 0
  );
  const frameCount = parseAddButtonInteger(
    fields[1], `${prefix}-frames`, dynamicFields, invalidFields, 1, 240
  );
  const frameIntervalMs = parseAddButtonInteger(
    fields[2], `${prefix}-interval`, dynamicFields, invalidFields, 1
  );
  const drawMode = parseAddButtonInteger(fields[3], `${prefix}-draw-mode`, dynamicFields, invalidFields);
  const offsetX = parseAddButtonInteger(fields[4], `${prefix}-offset-x`, dynamicFields, invalidFields);
  const offsetY = parseAddButtonInteger(fields[5], `${prefix}-offset-y`, dynamicFields, invalidFields);
  const localDynamic = dynamicFields.filter(field => field.startsWith(prefix));
  const localInvalid = invalidFields.filter(field => field.startsWith(prefix));
  return {
    state,
    ...(archive && imageIndex !== undefined
      ? { assetRef: addButtonAssetReference(archive, imageIndex) }
      : {}),
    frameCount,
    frameIntervalMs,
    drawMode,
    offsetX,
    offsetY,
    ...(localDynamic.length ? { dynamicFields: [...new Set(localDynamic)] } : {}),
    ...(localInvalid.length ? { invalidFields: [...new Set(localInvalid)] } : {}),
  };
}

function evidenceBlocked996AddButtonEx(
  source: string,
  invocation: AddButtonActionInvocation,
  ordinal: number
): DialogElement {
  const start = invocation.line.start + invocation.commandStart;
  const end = invocation.line.start
    + (invocation.arguments.at(-1)?.end ?? invocation.commandEnd);
  const warning = '[Evidence-blocked] 996PC ADDBUTTONEX 同时存在 legacy/new-NPC 方言与版本消歧缺口；'
    + 'Ctrl+F12 不能套用 GOM 五段基础/分组语法，不请求任何推测素材';
  return {
    id: `${start}:action-addbutton-preview:ADDBUTTONEX`,
    statementId: 'action-addbutton-preview',
    token: 'ADDBUTTONEX',
    description: '996PC ADDBUTTONEX 证据边界',
    kind: 'generic',
    raw: source.slice(start, end),
    lineNumber: invocation.line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: 'none',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: 16,
    localLayoutY: 16 + ordinal * 34,
    layoutX: 16,
    layoutY: 16 + ordinal * 34,
    width: 245,
    height: 80,
    sizePreview: {
      width: { mode: 'default', baseValue: 245 },
      height: { mode: 'default', baseValue: 80 },
    },
    addButtonPreview: {
      command: 'ADDBUTTONEX',
      engine: '996PC',
      status: 'evidence-blocked',
      localOnly: true,
      effects: [],
      deleteActions: [],
      dynamicFields: [],
      invalidFields: [],
    },
    warning,
  };
}

function buildAddButtonElement(
  source: string,
  invocation: AddButtonActionInvocation,
  ordinal: number,
  preview: {
    engine: EngineId;
    status: DialogAddButtonPreview['status'];
    triggerId?: number;
    movable?: boolean;
    groupId?: number;
    createPosition?: number;
    createPositionLabel?: string;
    x?: number;
    y?: number;
    xArgument?: { start: number; end: number };
    yArgument?: { start: number; end: number };
    title?: string;
    tooltipRaw?: string;
    assetRef?: DialogAssetReference;
    assetLayers?: DialogAssetLayer[];
    effects: DialogAddButtonEffectPreview[];
    dynamicFields: string[];
    invalidFields: string[];
    warning: string;
  }
): DialogElement {
  const start = invocation.line.start + invocation.commandStart;
  const end = invocation.line.start
    + (invocation.arguments.at(-1)?.end ?? invocation.commandEnd);
  const coordinate = (
    value: number | undefined,
    argument: { start: number; end: number } | undefined
  ): DialogCoordinate | undefined => value === undefined || !argument ? undefined : ({
    sourceValue: value,
    displayValue: value,
    span: span(source, invocation.line.start + argument.start, invocation.line.start + argument.end),
  });
  const xCoordinate = coordinate(preview.x, preview.xArgument);
  const yCoordinate = coordinate(preview.y, preview.yArgument);
  const x = preview.x ?? 16;
  const y = preview.y ?? 16 + ordinal * 34;
  const runtimeActionPreview: DialogRuntimeActionPreview | undefined = preview.triggerId === undefined
    ? undefined
    : {
      trigger: 'click',
      link: `@ButtonClick${preview.triggerId}`,
      localOnly: true,
    };
  return {
    id: `${start}:action-addbutton-preview:${invocation.command}`,
    statementId: 'action-addbutton-preview',
    token: invocation.command,
    description: `${preview.engine} ${invocation.command} 动作按钮`,
    kind: 'button',
    raw: source.slice(start, end),
    lineNumber: invocation.line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: xCoordinate && yCoordinate ? 'absolute' : 'none',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: Boolean(xCoordinate && yCoordinate),
    ...(xCoordinate ? { x: xCoordinate } : {}),
    ...(yCoordinate ? { y: yCoordinate } : {}),
    localLayoutX: x,
    localLayoutY: y,
    layoutX: x,
    layoutY: y,
    width: 72,
    height: 28,
    sizePreview: {
      width: { mode: 'intrinsic', baseValue: 72 },
      height: { mode: 'intrinsic', baseValue: 28 },
    },
    ...(preview.title ? {
      text: preview.title,
      textPreview: {
        lines: [[{ text: preview.title }]],
        align: 'center',
      },
    } : {}),
    ...(preview.tooltipRaw
      ? { tooltipPreview: parseAddButtonTooltipPreview(preview.tooltipRaw) }
      : {}),
    ...(preview.assetRef ? { assetRef: preview.assetRef } : {}),
    ...(preview.assetLayers?.length ? { assetLayers: preview.assetLayers } : {}),
    ...(runtimeActionPreview ? { runtimeActionPreview } : {}),
    addButtonPreview: {
      command: invocation.command as 'ADDBUTTON' | 'ADDBUTTONEX',
      engine: preview.engine,
      status: preview.status,
      ...(preview.triggerId === undefined ? {} : { triggerId: preview.triggerId }),
      ...(preview.movable === undefined ? {} : { movable: preview.movable }),
      ...(preview.groupId === undefined ? {} : { groupId: preview.groupId }),
      ...(preview.createPosition === undefined ? {} : {
        createPosition: preview.createPosition,
        createPositionLabel: preview.createPositionLabel,
      }),
      localOnly: true,
      effects: preview.effects,
      deleteActions: [],
      dynamicFields: preview.dynamicFields,
      invalidFields: preview.invalidFields,
    },
    warning: preview.warning,
  };
}

function parseAddButtonArchive(
  raw: string | undefined,
  field: string,
  dynamicFields: string[],
  invalidFields: string[],
  allowName: boolean
): AddButtonArchiveIdentity | undefined {
  if (!raw) {
    invalidFields.push(field);
    return undefined;
  }
  if (/<\$/i.test(raw)) {
    dynamicFields.push(field);
    return undefined;
  }
  const numeric = parseInteger(raw);
  if (numeric !== undefined && numeric >= 0) return { willIndex: numeric };
  if (allowName && /^[^\s|]+$/u.test(raw)) return { archiveName: raw };
  invalidFields.push(field);
  return undefined;
}

function parseAddButtonInteger(
  raw: string | undefined,
  field: string,
  dynamicFields: string[],
  invalidFields: string[],
  minimum?: number,
  maximum?: number
): number | undefined {
  if (!raw) {
    invalidFields.push(field);
    return undefined;
  }
  if (/<\$/i.test(raw)) {
    dynamicFields.push(field);
    return undefined;
  }
  const value = parseInteger(raw);
  if (
    value === undefined
    || (minimum !== undefined && value < minimum)
    || (maximum !== undefined && value > maximum)
  ) {
    invalidFields.push(field);
    return undefined;
  }
  return value;
}

function parseAddButtonText(
  raw: string | undefined,
  field: string,
  dynamicFields: string[],
  invalidFields: string[],
  required: boolean
): string | undefined {
  if (!raw) {
    if (required) invalidFields.push(field);
    return undefined;
  }
  if (/<\$/i.test(raw)) {
    dynamicFields.push(field);
    return undefined;
  }
  return raw === '-1' ? undefined : raw;
}

function parseAddButtonTooltipPreview(raw: string): DialogTooltipPreview {
  const separator = raw.indexOf('/');
  const colorSource = separator > 0 ? raw.slice(0, separator).trim() : '';
  const color = colorSource ? tooltipColor(colorSource) : undefined;
  const text = color && separator > 0 ? raw.slice(separator + 1) : raw;
  return {
    raw,
    kind: 'text',
    lines: [[{ text, ...(color ? { color } : {}) }]],
    offsetX: 0,
    offsetY: 0,
  };
}

function splitAddButtonPacked(raw: string | undefined): string[] {
  return raw === undefined ? [] : raw.split('|');
}

function addButtonPackedArgumentPart(
  argument: { start: number; end: number; text: string } | undefined,
  targetIndex: number
): { start: number; end: number } | undefined {
  if (!argument || targetIndex < 0) return undefined;
  let partIndex = 0;
  let partStart = 0;
  for (let offset = 0; offset <= argument.text.length; offset += 1) {
    if (offset < argument.text.length && argument.text[offset] !== '|') continue;
    if (partIndex === targetIndex) {
      return {
        start: argument.start + partStart,
        end: argument.start + offset,
      };
    }
    partIndex += 1;
    partStart = offset + 1;
  }
  return undefined;
}

function addButtonAssetReference(
  archive: AddButtonArchiveIdentity,
  imageIndex: number
): DialogAssetReference {
  return archive.willIndex !== undefined
    ? { willIndex: archive.willIndex, imageIndex }
    : { archiveName: archive.archiveName, imageIndex };
}

function addButtonStatus(
  dynamicFields: readonly string[],
  invalidFields: readonly string[]
): DialogAddButtonPreview['status'] {
  if (invalidFields.length > 0) return 'invalid';
  if (dynamicFields.length > 0) return 'dynamic';
  return 'partial-simulation';
}

function addButtonWarning(
  command: AddButtonActionCommand,
  engine: EngineId,
  status: DialogAddButtonPreview['status'],
  dynamicFields: readonly string[],
  invalidFields: readonly string[],
  hasEffectBlend = false
): string {
  const warnings = [
    '[Partial simulation] Ctrl+F12 仅本地绘制 #ACT 按钮和 ButtonClick 摘要；不执行或提交服务器标签，也不创建真实客户端宿主控件',
  ];
  if (hasEffectBlend) {
    warnings.push(`${engine} ${command} 的三态特效帧可静态分层；真实绘制模式/混合算法未公开，不能宣称客户端像素等价`);
  }
  if (status === 'dynamic') {
    warnings.push(`动态字段 ${dynamicFields.join('、')} 不借用 MOV 当前值；不生成或请求推测素材`);
  }
  if (status === 'invalid') {
    warnings.push(`无效字段 ${invalidFields.join('、')} 只保留命令证据；不猜测素材、位置或引擎字段`);
  }
  return warnings.join('；');
}

function parseAddDlgBinaryPair(
  raw: string | undefined,
  field: string,
  dynamicFields: string[],
  invalidFields: string[]
): [boolean | undefined, boolean | undefined] {
  if (!raw) return [false, false];
  if (/<\$/i.test(raw)) {
    dynamicFields.push(field);
    return [undefined, undefined];
  }
  const parts = raw.split(':');
  if (parts.length !== 2 || parts.some(part => part !== '0' && part !== '1')) {
    invalidFields.push(field);
    return [undefined, undefined];
  }
  return [parts[0] === '1', parts[1] === '1'];
}

function parseAddDlgPopup(
  raw: string | undefined,
  dynamicFields: string[],
  invalidFields: string[]
): Pick<DialogAddDlgWindow,
  'groupId' | 'displayMode' | 'popupDirection' | 'closeOnLeave' | 'closeDelayMs'> {
  const defaults = {
    groupId: 0,
    displayMode: 0,
    popupDirection: 0,
    closeOnLeave: false,
    closeDelayMs: 300,
  };
  if (!raw || raw === '0') return defaults;
  if (/<\$/i.test(raw)) {
    dynamicFields.push('popupBehavior');
    return defaults;
  }
  const parts = raw.split(':');
  if (parts.some((part, index) => index < parts.length - 1 && part === '')) {
    invalidFields.push('popupBehavior');
    return defaults;
  }
  const parsed = parts.map(parseInteger);
  if (parsed.some(value => value === undefined)) {
    invalidFields.push('popupBehavior');
    return defaults;
  }
  const [groupId = 0, displayMode = 0, popupDirection = 0, close = 0, delay = 300] = parsed as number[];
  if (groupId < 0 || groupId > 10) invalidFields.push('groupId');
  if (displayMode < 0 || displayMode > 4) invalidFields.push('displayMode');
  if (popupDirection < 0 || popupDirection > 9) invalidFields.push('popupDirection');
  if (close !== 0 && close !== 1) invalidFields.push('closeOnLeave');
  if (delay < 0 || delay > 5000) invalidFields.push('closeDelayMs');
  return {
    groupId: groupId >= 0 && groupId <= 10 ? groupId : 0,
    displayMode: displayMode >= 0 && displayMode <= 4 ? displayMode : 0,
    popupDirection: popupDirection >= 0 && popupDirection <= 9 ? popupDirection : 0,
    closeOnLeave: close === 1,
    closeDelayMs: delay >= 0 && delay <= 5000 ? delay : 300,
  };
}

function attachGomAddDlgWindows(
  source: string,
  sections: ScriptFunctionSection[],
  scenes: DialogScene[],
  windows: DialogAddDlgWindow[]
): void {
  const byName = new Map(sections.map(section => [normalizeLabel(section.label), section]));
  for (const window of windows) {
    if (!window.qfTarget) continue;
    const root = byName.get(normalizeLabel(window.qfTarget));
    if (!root) {
      window.warnings.push(`AddDlg 未找到 QF 标签 ${window.qfTarget}`);
      continue;
    }
    const reachable = findReachableSections(source, sections, root);
    const labels = new Set(reachable.map(section => normalizeLabel(section.label)));
    window.closeActions = collectAddDlgCloseActions(reachable);
    for (const scene of scenes) {
      if (!labels.has(normalizeLabel(scene.sourceLabel))) continue;
      if (scene.addDlgWindow && scene.addDlgWindow.id !== window.id) {
        window.warnings.push(`QF 页面 ${scene.sourceLabel} 同时被多个 AddDlg 引用，当前页面保留第一个窗口上下文`);
        continue;
      }
      scene.addDlgWindow = window;
      scene.warnings.push(...window.warnings);
    }
  }
}

function collectAddDlgCloseActions(
  sections: ScriptFunctionSection[]
): DialogAddDlgWindow['closeActions'] {
  const result: DialogAddDlgWindow['closeActions'] = [];
  for (const section of sections) {
    for (const line of section.lines.slice(1)) {
      const invocation = findScriptCommandInvocations(line.text, typedName => (
        /^DelDlg$/i.test(typedName) ? 'DelDlg' : undefined
      )).find(candidate => candidate.form === 'line');
      if (!invocation) continue;
      const raw = invocation.arguments[0]?.text;
      const scopeRaw = invocation.arguments[1]?.text;
      const scopeDynamic = Boolean(scopeRaw && /<\$/i.test(scopeRaw));
      const scopeValue = scopeRaw === undefined || scopeRaw === ''
        ? 0
        : scopeDynamic
          ? undefined
          : parseInteger(scopeRaw);
      result.push({
        dialogId: raw && !/<\$/i.test(raw) ? parseInteger(raw) : undefined,
        sourceLabel: section.label,
        lineNumber: line.lineNumber + 1,
        dynamic: Boolean(raw && /<\$/i.test(raw)),
        ...(scopeValue === 0 ? { scope: 'self' as const } : {}),
        ...(scopeValue === 1 ? { scope: 'all-users' as const } : {}),
        ...(scopeDynamic ? { scopeDynamic: true } : {}),
        ...(!scopeDynamic && scopeValue !== 0 && scopeValue !== 1 ? { invalid: true } : {}),
      });
    }
  }
  return result;
}

export function collectGomAddDlgCloseActions(
  source: string,
  targetLabel: string
): DialogAddDlgWindow['closeActions'] {
  const sections = findFunctionSections(source, scanScriptLines(source));
  const root = sections.find(section => normalizeLabel(section.label) === normalizeLabel(targetLabel));
  return root ? collectAddDlgCloseActions(findReachableSections(source, sections, root)) : [];
}

export function findNpcDialogFunctionLabelOffset(
  source: string,
  targetLabel: string
): number | undefined {
  const sections = findFunctionSections(source, scanScriptLines(source));
  return sections.find(section => normalizeLabel(section.label) === normalizeLabel(targetLabel))?.start;
}

function collectConditionGroups(
  section: ScriptFunctionSection,
  states: Readonly<Record<string, boolean>> | undefined
): DialogConditionGroup[] {
  const result: DialogConditionGroup[] = [];
  let groupNumber = 0;
  let current: DialogConditionGroup | undefined;
  let collecting = false;
  let operator: DialogConditionOperator = 'AND';
  const finish = () => {
    if (current && current.conditions.length > 0) result.push(current);
    current = undefined;
  };

  for (let index = 1; index < section.lines.length; index++) {
    const line = section.lines[index];
    const directive = directiveName(line.text);
    if (directive === 'IF') {
      finish();
      const id = makeConditionGroupId(section.label, ++groupNumber);
      current = {
        id,
        sourceLabel: section.label,
        title: `${section.label} · 条件 ${groupNumber}`,
        conditions: [],
        operators: [],
        satisfied: states?.[id] === true,
      };
      operator = 'AND';
      collecting = true;
      continue;
    }
    if (directive === 'OR') {
      operator = 'OR';
      collecting = true;
      continue;
    }
    if (directive) {
      collecting = false;
      continue;
    }
    const trimmed = line.text.trim();
    if (!collecting || !current || !trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) {
      continue;
    }
    current.conditions.push(trimmed);
    current.operators.push(current.conditions.length === 1 ? 'AND' : operator);
  }
  finish();
  return result;
}

function coalesceEquivalentConditionGroups(
  groups: readonly DialogConditionGroup[],
  states: Readonly<Record<string, boolean>> | undefined
): CoalescedConditionGroups {
  const aliases = new Map<string, string>();
  const canonicalBySignature = new Map<string, DialogConditionGroup>();
  const memberIds = new Map<string, string[]>();
  const result: DialogConditionGroup[] = [];

  for (const group of groups) {
    const signature = conditionGroupSignature(group);
    let canonical = canonicalBySignature.get(signature);
    if (!canonical) {
      canonical = {
        ...group,
        conditions: [...group.conditions],
        operators: [...group.operators],
        satisfied: false,
      };
      canonicalBySignature.set(signature, canonical);
      memberIds.set(canonical.id, []);
      result.push(canonical);
    }
    aliases.set(group.id, canonical.id);
    memberIds.get(canonical.id)!.push(group.id);
  }

  const expandedStates: Record<string, boolean> = {};
  for (const canonical of result) {
    const members = memberIds.get(canonical.id) || [canonical.id];
    let satisfied = false;
    if (hasOwnState(states, canonical.id)) {
      satisfied = states![canonical.id] === true;
    } else {
      const previousId = members.find(id => hasOwnState(states, id));
      if (previousId) satisfied = states![previousId] === true;
    }
    canonical.satisfied = satisfied;
    for (const id of members) expandedStates[id] = satisfied;
    expandedStates[canonical.id] = satisfied;
  }

  return { groups: result, aliases, expandedStates };
}

function conditionGroupSignature(group: DialogConditionGroup): string {
  return JSON.stringify([
    normalizeLabel(group.sourceLabel),
    group.conditions.map(normalizeConditionIdentity),
    group.operators,
  ]);
}

function normalizeConditionIdentity(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return collapsed.replace(/^([A-Za-z][A-Za-z0-9_.]*)\b/, command => command.toUpperCase());
}

function hasOwnState(
  states: Readonly<Record<string, boolean>> | undefined,
  id: string
): boolean {
  return Boolean(states && Object.prototype.hasOwnProperty.call(states, id));
}

function renumberVisibleConditionTitles(groups: DialogConditionGroup[]): void {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const key = normalizeLabel(group.sourceLabel);
    const number = (counts.get(key) || 0) + 1;
    counts.set(key, number);
    group.title = `${group.sourceLabel} · 条件 ${number}`;
  }
}

function parseSectionScenes(
  source: string,
  sourceLines: ReadonlyMap<number, ScriptLine>,
  section: ScriptFunctionSection,
  engine: EngineId,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  conditionAliases: ReadonlyMap<string, string>,
  sourceDocument: DialogSourceDocument,
  variableResolution?: DialogLabelVariableResolution
): DialogScene[] {
  const result: DialogScene[] = [];
  let conditions: string[] = [];
  let conditionOperators: DialogConditionOperator[] = [];
  let conditionGroupNumber = 0;
  let conditionGroupId: string | undefined;
  let conditionOperator: DialogConditionOperator = 'AND';
  let collectingConditions = false;
  let sceneNumber = 0;
  const defaultElements: DialogElement[] = [];
  const defaultUnsupported = new Set<string>();
  const defaultWarnings = new Set<string>();
  const defaultVariables = new Map<string, DialogResolvedVariable>();

  for (let index = 1; index < section.lines.length; index++) {
    const line = section.lines[index];
    const trimmed = line.text.trim();
    const directive = directiveName(trimmed);
    if (directive === 'IF') {
      conditions = [];
      conditionOperators = [];
      const rawConditionGroupId = makeConditionGroupId(section.label, ++conditionGroupNumber);
      conditionGroupId = conditionAliases.get(rawConditionGroupId) || rawConditionGroupId;
      conditionOperator = 'AND';
      collectingConditions = true;
      continue;
    }
    if (directive === 'OR') {
      conditionOperator = 'OR';
      collectingConditions = true;
      continue;
    }
    if (directive === 'ACT' || directive === 'ELSEACT') {
      collectingConditions = false;
      continue;
    }
    if (directive === 'SAY' || directive === 'ELSESAY') {
      const marker = `#${directive}` as '#SAY' | '#ELSESAY';
      const blockEndIndex = findSayBlockEnd(section.lines, index + 1);
      const blockLines = section.lines.slice(index + 1, blockEndIndex);
      const background = findBackgroundBefore(
        section.lines,
        index,
        source,
        engine,
        sourceDocument
      );
      const parsed = parseVisualElements(
        source,
        sourceLines,
        blockLines,
        offsets,
        schemasByToken,
        variableResolution
      );
      const isDefaultOutput = conditions.length === 0;
      const sceneElements = [...defaultElements, ...parsed.elements];
      const sceneUnsupported = [...new Set([
        ...defaultUnsupported,
        ...parsed.unsupported,
      ])];
      const sceneWarnings = [...new Set([
        ...defaultWarnings,
        ...parsed.warnings,
      ])];
      const sceneVariables = new Map(defaultVariables);
      parsed.resolvedVariables.forEach(variable => sceneVariables.set(variable.name, variable));
      const conditionSummary = summarizeCondition(marker, conditions, conditionOperators);
      result.push({
        id: `${normalizeLabel(section.label)}:${line.start}`,
        title: `${section.label} · ${conditionSummary || `场景 ${sceneNumber + 1}`}`,
        sourceLabel: section.label,
        marker,
        conditions: [...conditions],
        conditionOperators: [...conditionOperators],
        conditionGroupId: conditions.length > 0 ? conditionGroupId : undefined,
        previewPath: {},
        conditionSummary,
        sourceStart: line.start,
        sourceEnd: blockLines[blockLines.length - 1]?.fullEnd ?? line.fullEnd,
        background,
        elements: sceneElements,
        unsupportedStatements: sceneUnsupported,
        warnings: sceneWarnings,
        resolvedVariables: [...sceneVariables.values()],
      });
      if (isDefaultOutput) {
        defaultElements.push(...parsed.elements);
        parsed.unsupported.forEach(value => defaultUnsupported.add(value));
        parsed.warnings.forEach(value => defaultWarnings.add(value));
        parsed.resolvedVariables.forEach(variable => defaultVariables.set(variable.name, variable));
      }
      sceneNumber++;
      index = Math.max(index, blockEndIndex - 1);
      collectingConditions = false;
      continue;
    }
    if (collectingConditions && trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
      conditions.push(trimmed);
      conditionOperators.push(conditions.length === 1 ? 'AND' : conditionOperator);
    }
  }
  return result;
}

function parseStaticSectionScene(
  source: string,
  sourceLines: ReadonlyMap<number, ScriptLine>,
  section: ScriptFunctionSection,
  engine: EngineId,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  sourceDocument: DialogSourceDocument,
  variableResolution?: DialogLabelVariableResolution
): DialogScene | undefined {
  const blockLines = staticDisplayLines(section.lines.slice(1));
  const parsed = parseVisualElements(
    source,
    sourceLines,
    blockLines,
    offsets,
    schemasByToken,
    variableResolution
  );
  const background = findBackgroundBefore(
    section.lines,
    section.lines.length,
    source,
    engine,
    sourceDocument
  );
  if (parsed.elements.length === 0 && !background) return undefined;
  return {
    id: `${normalizeLabel(section.label)}:static`,
    title: `${section.label} · 静态预览`,
    sourceLabel: section.label,
    marker: 'STATIC',
    conditions: [],
    conditionOperators: [],
    previewPath: {},
    conditionSummary: '静态预览',
    sourceStart: section.start,
    sourceEnd: section.end,
    background,
    elements: parsed.elements,
    unsupportedStatements: parsed.unsupported,
    warnings: parsed.warnings,
    resolvedVariables: parsed.resolvedVariables,
  };
}

function staticDisplayLines(lines: ScriptLine[]): ScriptLine[] {
  const result: ScriptLine[] = [];
  let display = true;
  for (const line of lines) {
    const directive = directiveName(line.text);
    if (directive === 'SAY' || directive === 'ELSESAY') {
      display = true;
      continue;
    }
    if (directive) {
      display = false;
      continue;
    }
    if (display) result.push(line);
  }
  return result;
}

function findSayBlockEnd(lines: ScriptLine[], start: number): number {
  for (let index = start; index < lines.length; index++) {
    if (/^\s*(?:#(?:IF|OR|ACT|ELSEACT|SAY|ELSESAY)\b|\[@)/i.test(lines[index].text)) {
      return index;
    }
  }
  return lines.length;
}

type DialogBackgroundLifecycleCommand = DialogBackground['command']
  | 'CLOSEMERCHANTBIGDLG'
  | 'CLOSEBIGDIALOGBOX';

function findBackgroundBefore(
  lines: ScriptLine[],
  beforeIndex: number,
  source: string,
  engine: EngineId,
  sourceDocument: DialogSourceDocument
): DialogBackground | undefined {
  let merchant: { value: DialogBackground; order: number } | undefined;
  let openBig: { value: DialogBackground; order: number } | undefined;
  let order = 0;
  let actionMode = false;
  let sawDirective = false;

  for (let index = 1; index < Math.min(beforeIndex, lines.length); index++) {
    const line = lines[index];
    const directive = directiveName(line.text.trim());
    if (directive) {
      sawDirective = true;
      actionMode = directive === 'ACT' || directive === 'ELSEACT';
      continue;
    }
    if (sawDirective && !actionMode) continue;
    const invocation = findScriptCommandInvocations(
      line.text,
      (typedName): DialogBackgroundLifecycleCommand | undefined => {
        const command = typedName.toUpperCase();
        if (command === 'OPENMERCHANTBIGDLG'
          || command === 'OPENBIGDIALOGBOX'
          || command === 'CLOSEMERCHANTBIGDLG'
          || command === 'CLOSEBIGDIALOGBOX') {
          return command as DialogBackgroundLifecycleCommand;
        }
        return undefined;
      }
    ).find(candidate => candidate.form === 'line');
    if (!invocation) continue;

    if (invocation.command === 'OPENMERCHANTBIGDLG') {
      merchant = {
        value: parseDialogBackgroundCommand(
          source,
          line,
          engine,
          invocation,
          sourceDocument
        ),
        order: ++order,
      };
      continue;
    }
    if (invocation.command === 'OPENBIGDIALOGBOX') {
      openBig = {
        value: parseDialogBackgroundCommand(
          source,
          line,
          engine,
          invocation,
          sourceDocument
        ),
        order: ++order,
      };
      continue;
    }
    if (invocation.command === 'CLOSEMERCHANTBIGDLG') {
      merchant = undefined;
      continue;
    }
    // GOM/GEE publish this close for OpenBig only. The 996PC help explicitly
    // reuses it for both merchant and OpenBig background lifecycles.
    openBig = undefined;
    if (engine === '996PC') merchant = undefined;
  }

  if (!merchant) return openBig?.value;
  if (!openBig) return merchant.value;
  return merchant.order > openBig.order ? merchant.value : openBig.value;
}

function parseDialogBackgroundCommand(
  source: string,
  line: ScriptLine,
  engine: EngineId,
  invocation: ScriptCommandInvocation<DialogBackgroundLifecycleCommand>,
  sourceDocument: DialogSourceDocument
): DialogBackground {
  const command = invocation.command as DialogBackground['command'];
  const args = invocation.arguments.map(argument => argument.text);
  const dynamicFields: string[] = [];
  const invalidFields: string[] = [];
  const addDynamic = (field: string): void => {
    if (!dynamicFields.includes(field)) dynamicFields.push(field);
  };
  const addInvalid = (field: string): void => {
    if (!invalidFields.includes(field)) invalidFields.push(field);
  };
  const integer = (
    index: number,
    field: string,
    validate: (value: number) => boolean,
    required = false
  ): number | undefined => {
    const raw = args[index];
    if (raw === undefined || raw === '') {
      if (required) addInvalid(field);
      return undefined;
    }
    if (/<\$/i.test(raw)) {
      addDynamic(field);
      return undefined;
    }
    const value = parseInteger(raw);
    if (value === undefined || !validate(value)) {
      addInvalid(field);
      return undefined;
    }
    return value;
  };
  const binary = (index: number, field: string): boolean | undefined => {
    const value = integer(index, field, candidate => candidate === 0 || candidate === 1);
    return value === undefined ? undefined : value === 1;
  };
  const argumentMissing = (index: number): boolean => (
    args[index] === undefined || args[index] === ''
  );
  const compositeInteger = (
    raw: string | undefined,
    field: string,
    validate: (value: number) => boolean
  ): number | undefined => {
    if (raw === undefined || raw === '') {
      addInvalid(field);
      return undefined;
    }
    if (/<\$/i.test(raw)) {
      addDynamic(field);
      return undefined;
    }
    const value = parseInteger(raw);
    if (value === undefined || !validate(value)) {
      addInvalid(field);
      return undefined;
    }
    return value;
  };

  const willIndex = integer(0, 'will-index', value => value >= 0, true);
  let imageIndex: number | undefined;
  let nineGrid: DialogBackground['nineGrid'];
  const imageRaw = args[1];
  if (imageRaw === undefined || imageRaw === '') {
    addInvalid('image-index');
  } else if (imageRaw.includes('|')) {
    if (engine !== 'GOM' || command !== 'OPENMERCHANTBIGDLG') {
      addInvalid('image-index');
    } else {
      const parts = imageRaw.split('|');
      if (parts.length !== 4) {
        addInvalid('image-index');
      } else {
        imageIndex = compositeInteger(parts[0], 'image-index', value => value >= 0);
        const enabled = compositeInteger(parts[1], 'nine-grid-enabled', value => value === 1);
        const width = compositeInteger(parts[2], 'nine-grid-width', value => value > 0);
        const height = compositeInteger(parts[3], 'nine-grid-height', value => value > 0);
        nineGrid = {
          ...(enabled === 1 ? { enabled: true as const } : {}),
          ...(width !== undefined ? { targetWidth: width } : {}),
          ...(height !== undefined ? { targetHeight: height } : {}),
          rendering: 'partial-simulation',
        };
      }
    }
  } else if (/<\$/i.test(imageRaw)) {
    addDynamic('image-index');
  } else {
    const image = parseInteger(imageRaw);
    if (image === undefined || image < 0) addInvalid('image-index');
    else imageIndex = image;
  }

  let movable: boolean | undefined;
  let position: DialogBackground['position'];
  let offsetX: number | undefined;
  let offsetY: number | undefined;
  let showCloseButton: boolean | undefined;
  let closeButtonX: number | undefined;
  let closeButtonY: number | undefined;
  let independentWindow: boolean | undefined;
  let continueUse: boolean | undefined;
  const hasFullRuntimeFields = command === 'OPENMERCHANTBIGDLG'
    || (command === 'OPENBIGDIALOGBOX' && engine === 'GEE');
  if (hasFullRuntimeFields) {
    movable = binary(2, 'movable');
    const parsedPosition = integer(3, 'position', value => value >= 0 && value <= 4);
    if (parsedPosition !== undefined) position = parsedPosition as DialogBackground['position'];
    else if (argumentMissing(3)) position = 0;
    offsetX = integer(4, 'offset-x', () => true);
    if (offsetX === undefined && argumentMissing(4)) offsetX = 0;
    offsetY = integer(5, 'offset-y', () => true);
    if (offsetY === undefined && argumentMissing(5)) offsetY = 0;
    showCloseButton = binary(6, 'show-close');
    closeButtonX = integer(7, 'close-x', () => true);
    closeButtonY = integer(8, 'close-y', () => true);
  }

  if (command === 'OPENMERCHANTBIGDLG') {
    const tail = binary(9, engine === 'GEE' ? 'continue-use' : 'independent-window');
    if (engine === 'GEE') continueUse = tail;
    else independentWindow = tail;
    if (args.length > 10) addInvalid('extra-parameters');
  } else {
    const maximum = engine === 'GEE' ? 9 : 2;
    if (args.length > maximum) addInvalid('extra-parameters');
  }

  const status: DialogBackground['status'] = invalidFields.length > 0
    ? 'invalid'
    : dynamicFields.length > 0
      ? 'dynamic'
      : 'static';
  const resourceFieldNames = new Set(['will-index', 'image-index']);
  const dynamicResourceFields = dynamicFields.filter(field => resourceFieldNames.has(field));
  const invalidResourceFields = invalidFields.filter(field => resourceFieldNames.has(field));
  const dynamicNonResourceFields = dynamicFields.filter(field => !resourceFieldNames.has(field));
  const invalidNonResourceFields = invalidFields.filter(field => !resourceFieldNames.has(field));
  const warnings = [
    '背景开关、移动、关闭和窗口生命周期仅作本地展示，不控制真实客户端',
    dynamicResourceFields.length > 0
      ? `背景资源字段 ${dynamicResourceFields.join('、')} 是动态表达式；Ctrl+F12 不借用 MOV 当前值，也不请求临时素材`
      : undefined,
    invalidResourceFields.length > 0
      ? `背景资源字段 ${invalidResourceFields.join('、')} 无效、缺失或超出范围；已保留命令诊断并禁止素材请求`
      : undefined,
    dynamicNonResourceFields.length > 0
      ? `背景运行或几何字段 ${dynamicNonResourceFields.join('、')} 是动态表达式；背景素材仍按独立静态资源字段绘制，未知行为不借用 MOV 当前值`
      : undefined,
    invalidNonResourceFields.length > 0
      ? `背景运行或几何字段 ${invalidNonResourceFields.join('、')} 无效、缺失或超出范围；背景素材仍按独立静态资源字段绘制`
      : undefined,
    nineGrid
      ? 'Partial simulation：GOM 九宫格只按已证明的目标宽高绘制；客户端源图切片边界和舍入算法未公开'
      : undefined,
  ].filter((value): value is string => Boolean(value));

  const absoluteStart = line.start + invocation.commandSpan.start;
  const absoluteEnd = line.start
    + (invocation.arguments.at(-1)?.end ?? invocation.commandSpan.end);
  const offsetBinding = createSeparatedCoordinateBinding(
    source,
    line,
    invocation.arguments[4],
    invocation.arguments[5],
    offsetX,
    offsetY,
    'dialog-background-offset',
    absoluteStart,
    sourceDocument
  );

  const result: DialogBackground = {
    command,
    status,
    raw: source.slice(absoluteStart, absoluteEnd),
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, absoluteStart, absoluteEnd),
    sourceUri: sourceDocument.uri,
    sourceFilePath: sourceDocument.filePath,
    sourceDocumentVersion: sourceDocument.documentVersion,
    runtimeScope: 'local-only',
    ...(willIndex !== undefined ? { willIndex } : {}),
    ...(imageIndex !== undefined ? { imageIndex } : {}),
    ...(movable !== undefined ? { movable } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(offsetX !== undefined ? { offsetX } : {}),
    ...(offsetY !== undefined ? { offsetY } : {}),
    ...(offsetBinding ? { offsetBinding } : {}),
    ...(showCloseButton !== undefined ? { showCloseButton } : {}),
    ...(closeButtonX !== undefined ? { closeButtonX } : {}),
    ...(closeButtonY !== undefined ? { closeButtonY } : {}),
    ...(independentWindow !== undefined ? { independentWindow } : {}),
    ...(continueUse !== undefined ? { continueUse } : {}),
    ...(nineGrid ? { nineGrid } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    warning: warnings.join('；'),
    warnings,
  };
  if (
    dynamicResourceFields.length === 0
    && invalidResourceFields.length === 0
    && willIndex !== undefined
    && imageIndex !== undefined
  ) {
    result.assetRef = { willIndex, imageIndex };
  }
  return result;
}

function parseVisualElements(
  source: string,
  sourceLines: ReadonlyMap<number, ScriptLine>,
  lines: ScriptLine[],
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  variableResolution?: DialogLabelVariableResolution
): {
  elements: DialogElement[];
  unsupported: string[];
  warnings: string[];
  resolvedVariables: DialogResolvedVariable[];
} {
  const elements: DialogElement[] = [];
  const unsupported = new Set<string>();
  const warnings: string[] = [];
  const resolvedVariables = new Map<string, DialogResolvedVariable>();
  const flow = createFlowLayoutCursor(offsets);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const firstLineIndex = lineIndex;
    const coalesced = coalesceMultilineMTextLine(source, lines, lineIndex);
    const line = coalesced?.line ?? lines[lineIndex];
    const lastLineIndex = coalesced?.lastLineIndex ?? lineIndex;
    for (let coveredIndex = lineIndex; coveredIndex <= lastLineIndex; coveredIndex++) {
      variableResolution?.lines.get(lines[coveredIndex].lineNumber)?.variables
        .forEach(variable => resolvedVariables.set(variable.name, variable));
    }
    lineIndex = lastLineIndex;
    if (!line.text.trim() || /^\s*;/.test(line.text)) continue;
    const resolution = coalesced
      ? resolveCoalescedMarkupLine(
        source,
        lines,
        firstLineIndex,
        lastLineIndex,
        variableResolution
      )
      : variableResolution?.lines.get(line.lineNumber);
    const displayText = resolution?.text ?? line.text;
    const generated = displayText !== line.text;
    const parsed = generated
      ? parseResolvedMarkupLine(
        source,
        sourceLines,
        line,
        displayText,
        resolution?.variables || [],
        offsets,
        schemasByToken,
        flow
      )
      : parseMarkupLine(source, line, offsets, schemasByToken, flow);
    elements.push(...parsed.elements);
    parsed.unsupported.forEach(value => unsupported.add(value));
  }

  applyContainerLayout(elements, offsets, warnings);

  if (elements.some(element => element.warning?.includes('动态坐标'))) {
    warnings.push('动态表达式坐标只做占位预览，不能通过拖动改写');
  }
  if (unsupported.size > 0) {
    warnings.push('未确认的界面语句已锁定并保持原文');
  }
  if (elements.some(element => element.warning?.includes('脚本变量'))) {
    warnings.push('部分脚本变量界面无法唯一定位坐标源码，已保持只读');
  }
  return {
    elements,
    unsupported: [...unsupported],
    warnings,
    resolvedVariables: [...resolvedVariables.values()],
  };
}

interface CoalescedMarkupLine {
  line: ScriptLine;
  lastLineIndex: number;
}

function resolveCoalescedMarkupLine(
  source: string,
  lines: readonly ScriptLine[],
  firstLineIndex: number,
  lastLineIndex: number,
  variableResolution: DialogLabelVariableResolution | undefined
): { text: string; variables: DialogResolvedVariable[] } | undefined {
  if (!variableResolution) return undefined;
  const parts: string[] = [];
  const variables = new Map<string, DialogResolvedVariable>();
  let foundResolution = false;
  for (let index = firstLineIndex; index <= lastLineIndex; index++) {
    const physicalLine = lines[index];
    const resolution = variableResolution.lines.get(physicalLine.lineNumber);
    if (resolution) {
      foundResolution = true;
      parts.push(resolution.text);
      for (const variable of resolution.variables) {
        const key = variable.name.trim().toUpperCase();
        const previous = variables.get(key);
        // A single unresolved occurrence keeps the combined text field in the
        // runtime-placeholder state even if another physical row proved the
        // same variable on its own static path.
        if (!previous || (previous.status === 'resolved' && variable.status === 'default')) {
          variables.set(key, variable);
        }
      }
    } else {
      parts.push(physicalLine.text);
    }
    if (index < lastLineIndex) {
      parts.push(source.slice(physicalLine.end, lines[index + 1].start));
    }
  }
  return foundResolution ? { text: parts.join(''), variables: [...variables.values()] } : undefined;
}

function coalesceMultilineMTextLine(
  source: string,
  lines: readonly ScriptLine[],
  lineIndex: number
): CoalescedMarkupLine | undefined {
  const firstLine = lines[lineIndex];
  if (!firstLine.text.trim() || /^\s*;/.test(firstLine.text)) return undefined;
  const match = /<MText(?=\s*:)/i.exec(firstLine.text);
  if (!match) return undefined;
  const markupStart = firstLine.start + match.index;
  if (findMarkupEnd(source, markupStart, firstLine.end) > markupStart) return undefined;

  // MText is the only documented dialog control whose official GOM/GEE sample
  // intentionally spans physical script lines. Bound the scan so a missing '>'
  // cannot consume a following script block or another UI statement.
  const maximumLastLine = Math.min(lines.length - 1, lineIndex + 63);
  for (let candidateIndex = lineIndex + 1; candidateIndex <= maximumLastLine; candidateIndex++) {
    const candidate = lines[candidateIndex];
    const trimmed = candidate.text.trim();
    if (/^(?:;|\[@|#[A-Za-z_])/.test(trimmed)) return undefined;
    if (/^<&?[A-Za-z_][A-Za-z0-9_.]*\s*[:|>]/.test(trimmed)) return undefined;
    if (candidate.end - markupStart > 64 * 1024) return undefined;
    if (findMarkupEnd(source, markupStart, candidate.end) <= markupStart) continue;
    return {
      line: {
        text: source.slice(firstLine.start, candidate.end),
        start: firstLine.start,
        end: candidate.end,
        fullEnd: candidate.fullEnd,
        lineNumber: firstLine.lineNumber,
      },
      lastLineIndex: candidateIndex,
    };
  }
  return undefined;
}

function parseResolvedMarkupLine(
  source: string,
  sourceLines: ReadonlyMap<number, ScriptLine>,
  originalLine: ScriptLine,
  resolvedText: string,
  variables: readonly DialogResolvedVariable[],
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  flow: FlowLayoutCursor
): { elements: DialogElement[]; unsupported: string[] } {
  const generatedLine: ScriptLine = {
    text: resolvedText,
    start: 0,
    end: resolvedText.length,
    fullEnd: resolvedText.length,
    lineNumber: originalLine.lineNumber,
  };
  const parsed = parseMarkupLine(
    resolvedText,
    generatedLine,
    offsets,
    schemasByToken,
    flow
  );
  const candidates = collectVariableSourceElements(
    source,
    sourceLines,
    originalLine,
    variables,
    offsets,
    schemasByToken
  );
  const used = new Set<number>();
  parsed.elements = parsed.elements.map((element, index) => {
    const candidateIndex = candidates.findIndex((candidate, sourceIndex) => (
      !used.has(sourceIndex)
      && candidate.statementId === element.statementId
      && candidate.token.toUpperCase() === element.token.toUpperCase()
    ));
    if (candidateIndex >= 0) {
      used.add(candidateIndex);
      const sourceElement = candidates[candidateIndex];
      return bindResolvedPreviewToSource(
        element,
        sourceElement,
        sourceElement.lineNumber === originalLine.lineNumber + 1,
        variables
      );
    }
    return {
      ...element,
      id: `${originalLine.start}:VARIABLE:${index}:${element.statementId}`,
      lineNumber: originalLine.lineNumber + 1,
      sourceRange: span(source, originalLine.start, originalLine.end),
      editable: false,
      warning: '脚本变量界面无法唯一定位坐标源码，当前仅作预览',
    };
  });
  return parsed;
}

function collectVariableSourceElements(
  source: string,
  sourceLines: ReadonlyMap<number, ScriptLine>,
  originalLine: ScriptLine,
  variables: readonly DialogResolvedVariable[],
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>
): DialogElement[] {
  const lineNumbers: number[] = [];
  for (const variable of variables) {
    const references = variable.sourceReferences?.length
      ? variable.sourceReferences
      : variable.sourceLine !== undefined
        ? [{ sourceLabel: variable.sourceLabel || '', sourceLine: variable.sourceLine }]
        : [];
    for (const reference of references) lineNumbers.push(reference.sourceLine - 1);
  }

  const result: DialogElement[] = [];
  // Parse the actual display source first. Unlike a variable definition line,
  // this line may legitimately be ordinary flow text. It may also be a
  // synthetic, complete cross-physical-line MText assembled by the caller.
  const displaySource = parseMarkupLine(
    source,
    originalLine,
    offsets,
    schemasByToken,
    createFlowLayoutCursor(offsets)
  );
  result.push(...displaySource.elements);

  const visited = new Set<number>([originalLine.lineNumber]);
  for (const lineNumber of lineNumbers) {
    if (visited.has(lineNumber)) continue;
    visited.add(lineNumber);
    const line = sourceLines.get(lineNumber);
    if (!line) continue;
    const parsed = parseMarkupLine(
      source,
      line,
      offsets,
      schemasByToken,
      createFlowLayoutCursor(offsets)
    );
    for (const element of parsed.elements) {
      const original = source.slice(element.sourceRange.start, element.sourceRange.end).trimStart();
      // Referenced MOV/list source lines can contain a complete UI markup value,
      // but their surrounding command text must never become dialog flow text.
      if (original.startsWith('<') && element.statementId !== 'flow-text') result.push(element);
    }
  }
  return result;
}

function bindResolvedPreviewToSource(
  preview: DialogElement,
  sourceElement: DialogElement,
  sourceIsOriginalDisplayLine: boolean,
  variables: readonly DialogResolvedVariable[]
): DialogElement {
  let sourceBound = bindSourceSensitiveControlPreview(
    preview,
    sourceElement,
    sourceIsOriginalDisplayLine,
    variables
  );
  const sourceLegacyLayoutUnsafe = Boolean(
    sourceElement.layoutPreview?.legacyCenterDynamicAxes?.length
    || sourceElement.layoutPreview?.legacyCenterInvalidAxes?.length
  );
  if (sourceLegacyLayoutUnsafe) {
    sourceBound = {
      ...sourceBound,
      coordinateMode: sourceElement.coordinateMode,
      x: sourceElement.x,
      y: sourceElement.y,
      localLayoutX: sourceElement.localLayoutX,
      localLayoutY: sourceElement.localLayoutY,
      layoutX: sourceElement.layoutX,
      layoutY: sourceElement.layoutY,
      layoutPreview: sourceElement.layoutPreview,
      warning: mergeWarningClauses(
        sourceBound.warning,
        sourceElement.warning
      ),
    };
  }
  if (sourceElement.coordinateMode === 'flow') {
    return {
      ...sourceBound,
      id: sourceElement.id,
      lineNumber: sourceElement.lineNumber,
      sourceRange: sourceElement.sourceRange,
      coordinateMode: 'flow',
      sourceCoordinateBiasX: sourceElement.sourceCoordinateBiasX,
      sourceCoordinateBiasY: sourceElement.sourceCoordinateBiasY,
      editable: false,
      x: undefined,
      y: undefined,
      warning: mergeWarningClauses(sourceBound.warning, sourceElement.warning),
    };
  }
  const hasStaticSourceCoordinates = Boolean(sourceElement.x && sourceElement.y);
  const editable = sourceElement.editable && hasStaticSourceCoordinates;
  if (!editable) {
    return {
      ...sourceBound,
      id: sourceElement.id,
      lineNumber: sourceElement.lineNumber,
      sourceRange: sourceElement.sourceRange,
      coordinateMode: sourceElement.coordinateMode,
      sourceCoordinateBiasX: sourceElement.sourceCoordinateBiasX,
      sourceCoordinateBiasY: sourceElement.sourceCoordinateBiasY,
      editable: false,
      // A generated preview coordinate can locate the read-only element, but
      // its span belongs to the synthetic string. Only source coordinates may
      // be exposed through DialogCoordinate for Inspector/source patch audit.
      x: sourceElement.x,
      y: sourceElement.y,
      warning: mergeWarningClauses(
        sourceBound.warning,
        !hasStaticSourceCoordinates
          ? '脚本变量界面的坐标仍是动态表达式，当前仅按预览值显示'
          : undefined
      ),
    };
  }
  return {
    ...sourceBound,
    id: sourceElement.id,
    lineNumber: sourceElement.lineNumber,
    sourceRange: sourceElement.sourceRange,
    coordinateMode: sourceElement.coordinateMode,
    sourceCoordinateBiasX: sourceElement.sourceCoordinateBiasX,
    sourceCoordinateBiasY: sourceElement.sourceCoordinateBiasY,
    editable: true,
    x: sourceElement.x,
    y: sourceElement.y,
    localLayoutX: sourceElement.localLayoutX,
    localLayoutY: sourceElement.localLayoutY,
    layoutX: sourceElement.layoutX,
    layoutY: sourceElement.layoutY,
    warning: sourceBound.warning,
  };
}

function bindSourceSensitiveControlPreview(
  preview: DialogElement,
  sourceElement: DialogElement,
  sourceIsOriginalDisplayLine: boolean,
  variables: readonly DialogResolvedVariable[]
): DialogElement {
  const allSourceVariablesResolved = variables.length > 0
    && variables.every(variable => variable.status === 'resolved');
  const sourceContainsRuntimeExpression = sourceIsOriginalDisplayLine
    && /<\$/i.test(sourceElement.raw);
  const sourceTextControl = sourceContainsRuntimeExpression
    && sourceElement.kind === 'text'
    && preview.kind === 'text';
  let bound: DialogElement = sourceContainsRuntimeExpression && !sourceTextControl
    ? {
      ...preview,
      // The resolved preview is useful for locating the right source control,
      // but it is not evidence that a runtime expression has a stable value.
      // Explicitly copy every source-sensitive field (including `undefined`)
      // so a temporary MOV value cannot survive merely because the unresolved
      // source element omitted an optional property.
      raw: sourceElement.raw,
      width: sourceElement.width,
      height: sourceElement.height,
      text: sourceElement.text,
      color: sourceElement.color,
      parameters: sourceElement.parameters,
      assetRef: sourceElement.assetRef,
      asset: undefined,
      assetLayers: sourceElement.assetLayers,
      assetStateDiagnostics: sourceElement.assetStateDiagnostics,
      animationPreview: sourceElement.animationPreview,
      animationFrames: undefined,
      tooltipPreview: sourceElement.tooltipPreview,
      itemPreview: sourceElement.itemPreview,
      costItemPreview: sourceElement.costItemPreview,
      progressPreview: sourceElement.progressPreview,
      sliderPreview: sourceElement.sliderPreview,
      runtimeActionPreview: sourceElement.runtimeActionPreview,
      inputPreview: sourceElement.inputPreview,
      togglePreview: sourceElement.togglePreview,
      textPreview: sourceElement.textPreview,
      menuPreview: sourceElement.menuPreview,
      countdownPreview: sourceElement.countdownPreview,
      imageTextPreview: sourceElement.imageTextPreview,
      imagePreview: sourceElement.imagePreview,
      modelPreview: sourceElement.modelPreview,
      monsterPreview: sourceElement.monsterPreview,
      containerPreview: sourceElement.containerPreview,
      layoutPreview: sourceElement.layoutPreview,
      sizePreview: sourceElement.sizePreview,
      containerElementId: sourceElement.containerElementId,
      containerParentId: sourceElement.containerParentId,
      containerChildIds: sourceElement.containerChildIds,
      parentElementId: sourceElement.parentElementId,
      warning: mergeWarningClauses(
        preview.warning,
        sourceElement.warning,
        '源码含运行时表达式：静态已确定值直接显示，未确定文字显示“预览文字”，未确定数量显示 0'
      ),
    }
    : sourceContainsRuntimeExpression
      ? {
        ...preview,
        raw: sourceElement.raw,
        parameters: sourceElement.parameters,
      }
      : preview;
  const sourceHasDynamicText = sourceContainsRuntimeExpression
    && sourceElement.textPreview?.dynamicFields?.includes('text');
  if (sourceHasDynamicText && sourceElement.textPreview && preview.textPreview) {
    const textValueStatus = runtimeTextValueStatus(sourceElement.text || '', variables);
    bound = {
      ...bound,
      // The variable resolver already separates proven values from neutral
      // placeholders. Keep that useful visible result while raw/parameters
      // continue to point at the original expression for source auditing.
      text: preview.text,
      width: preview.width,
      height: preview.height,
      sizePreview: preview.sizePreview,
      textPreview: {
        ...sourceElement.textPreview,
        ...preview.textPreview,
        lines: preview.textPreview.lines.map(line => line.map(run => ({ ...run }))),
        sourceText: sourceElement.text,
        textValueStatus,
      },
    };
  }
  if (sourceElement.assetStateDiagnostics) {
    bound = {
      ...bound,
      assetRef: sourceElement.assetRef,
      asset: undefined,
      assetLayers: sourceElement.assetLayers,
      assetStateDiagnostics: sourceElement.assetStateDiagnostics.map(diagnostic => ({
        ...diagnostic,
        ...(diagnostic.assetRef ? { assetRef: { ...diagnostic.assetRef } } : {}),
        asset: undefined,
      })),
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (
    preview.containerPreview?.variant === 'list'
    && sourceElement.containerPreview?.variant === 'list'
  ) {
    bound = {
      ...bound,
      assetLayers: sourceElement.assetLayers,
      containerPreview: {
        ...sourceElement.containerPreview,
        ...(sourceElement.containerPreview.defaultFields
          ? { defaultFields: [...sourceElement.containerPreview.defaultFields] }
          : {}),
        ...(sourceElement.containerPreview.dynamicFields
          ? { dynamicFields: [...sourceElement.containerPreview.dynamicFields] }
          : {}),
        ...(sourceElement.containerPreview.invalidFields
          ? { invalidFields: [...sourceElement.containerPreview.invalidFields] }
          : {}),
        ...(sourceElement.containerPreview.fieldDiagnostics
          ? { fieldDiagnostics: sourceElement.containerPreview.fieldDiagnostics.map(value => ({ ...value })) }
          : {}),
        ...(sourceElement.containerPreview.scrollbarDiagnostics
          ? {
            scrollbarDiagnostics: sourceElement.containerPreview.scrollbarDiagnostics.map(value => ({
              ...value,
              ...(value.assetRef ? { assetRef: { ...value.assetRef } } : {}),
              asset: undefined,
            })),
          }
          : {}),
      },
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (
    bound.containerPreview?.variant === 'item-grid'
    && sourceElement.containerPreview?.variant === 'item-grid'
  ) {
    const containerPreview: DialogContainerPreview = {
      ...sourceElement.containerPreview,
    };
    if (sourceElement.containerPreview.defaultFields?.length) {
      containerPreview.defaultFields = [...sourceElement.containerPreview.defaultFields];
    }
    if (sourceElement.containerPreview.dynamicFields?.length) {
      containerPreview.dynamicFields = [...sourceElement.containerPreview.dynamicFields];
    }
    if (sourceElement.containerPreview.invalidFields?.length) {
      containerPreview.invalidFields = [...sourceElement.containerPreview.invalidFields];
    }
    const derivedWidth = itemGridPreviewSize(containerPreview, 'width');
    const derivedHeight = itemGridPreviewSize(containerPreview, 'height');
    const sizePreview = bound.sizePreview
      ? {
        width: bound.sizePreview.width.mode === 'derived'
          ? { ...bound.sizePreview.width, baseValue: derivedWidth }
          : bound.sizePreview.width,
        height: bound.sizePreview.height.mode === 'derived'
          ? { ...bound.sizePreview.height, baseValue: derivedHeight }
          : bound.sizePreview.height,
      }
      : undefined;
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      containerPreview,
      width: bound.sizePreview?.width.mode === 'derived' ? derivedWidth : bound.width,
      height: bound.sizePreview?.height.mode === 'derived' ? derivedHeight : bound.height,
      ...(sizePreview ? { sizePreview } : {}),
      warning: sourceElement.warning || bound.warning,
    };
  }
  const sourceCompletionActionIsUncertain = Boolean(
    sourceElement.runtimeActionPreview?.trigger === 'completion'
    && (
      sourceElement.runtimeActionPreview.dynamicFields?.length
      || sourceElement.runtimeActionPreview.invalidFields?.length
    )
  );
  if (
    bound.runtimeActionPreview
    && sourceElement.runtimeActionPreview
    && (!allSourceVariablesResolved || sourceCompletionActionIsUncertain)
  ) {
    const runtimeActionPreview: DialogRuntimeActionPreview = {
      ...sourceElement.runtimeActionPreview,
      ...(sourceElement.runtimeActionPreview.submitInputIds?.length
        ? { submitInputIds: [...sourceElement.runtimeActionPreview.submitInputIds] }
        : {}),
      ...(sourceElement.runtimeActionPreview.parameters
        ? { parameters: [...sourceElement.runtimeActionPreview.parameters] }
        : {}),
      ...(sourceElement.runtimeActionPreview.dynamicFields?.length
        ? { dynamicFields: [...sourceElement.runtimeActionPreview.dynamicFields] }
        : {}),
      ...(sourceElement.runtimeActionPreview.invalidFields?.length
        ? { invalidFields: [...sourceElement.runtimeActionPreview.invalidFields] }
        : {}),
    };
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      runtimeActionPreview,
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (bound.inputPreview && sourceElement.inputPreview) {
    const inputPreview: DialogInputPreview = {
      ...sourceElement.inputPreview,
      ...(sourceElement.inputPreview.dynamicFields?.length
        ? { dynamicFields: [...sourceElement.inputPreview.dynamicFields] }
        : {}),
      ...(sourceElement.inputPreview.invalidFields?.length
        ? { invalidFields: [...sourceElement.inputPreview.invalidFields] }
        : {}),
    };
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      inputPreview,
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (bound.menuPreview && sourceElement.menuPreview) {
    const sourceMenu = sourceElement.menuPreview;
    const dynamicFields = [...new Set([
      ...(bound.menuPreview.dynamicFields || []),
      ...(sourceMenu.dynamicFields || []),
    ])];
    const menuPreview: DialogMenuPreview = { ...bound.menuPreview };
    delete menuPreview.dynamic;
    delete menuPreview.defaultFields;
    delete menuPreview.dynamicFields;
    delete menuPreview.invalidFields;
    if (sourceMenu.defaultFields?.length) {
      menuPreview.defaultFields = [...sourceMenu.defaultFields];
    }
    if (dynamicFields.length > 0) {
      menuPreview.dynamic = true;
      menuPreview.dynamicFields = dynamicFields;
    }
    if (sourceMenu.invalidFields?.length) {
      menuPreview.invalidFields = [...sourceMenu.invalidFields];
    }
    const sourceSensitiveFields = new Set([
      ...(sourceMenu.defaultFields || []),
      ...(sourceMenu.dynamicFields || []),
      ...(sourceMenu.invalidFields || []),
    ]);
    if (sourceSensitiveFields.has('itemname')) menuPreview.items = [...sourceMenu.items];
    if (sourceSensitiveFields.has('select')) menuPreview.selected = sourceMenu.selected;
    if (sourceSensitiveFields.has('direction')) menuPreview.direction = sourceMenu.direction;
    if (sourceSensitiveFields.has('itemhei')) menuPreview.itemHeight = sourceMenu.itemHeight;
    if (sourceSensitiveFields.has('maxhei')) {
      if (sourceMenu.maxHeight !== undefined) menuPreview.maxHeight = sourceMenu.maxHeight;
      else delete menuPreview.maxHeight;
    }
    if (sourceSensitiveFields.has('fontcolor')) {
      if (sourceMenu.fontColor) menuPreview.fontColor = sourceMenu.fontColor;
      else delete menuPreview.fontColor;
    }
    if (sourceSensitiveFields.has('selectcolor')) {
      if (sourceMenu.selectedColor) menuPreview.selectedColor = sourceMenu.selectedColor;
      else delete menuPreview.selectedColor;
    }
    if (sourceSensitiveFields.has('menuid')) {
      if (sourceMenu.menuId) menuPreview.menuId = sourceMenu.menuId;
      else delete menuPreview.menuId;
    }
    if (sourceSensitiveFields.has('link')) {
      if (sourceMenu.link) menuPreview.link = sourceMenu.link;
      else delete menuPreview.link;
    }
    const sourceAssets = ['direction', 'img', 'arrowimg', 'selectimg', 'listimg'].some(
      field => sourceSensitiveFields.has(field as NonNullable<DialogMenuPreview['dynamicFields']>[number])
    );
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      ...(sourceAssets ? {
        assetRef: sourceElement.assetRef,
        assetLayers: sourceElement.assetLayers,
      } : {}),
      menuPreview,
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (bound.itemPreview && sourceElement.itemPreview) {
    const databaseItemIndex = staticallyResolvedDatabaseItemIndex(
      sourceElement,
      preview,
      variables
    );
    const sourceDynamicFields = (sourceElement.itemPreview.dynamicFields || []).filter(field => (
      field !== 'itemid' || databaseItemIndex === undefined
    ));
    const sourceSensitiveFields = [
      ...sourceDynamicFields,
      ...(sourceElement.itemPreview.invalidFields || []),
    ];
    if (sourceSensitiveFields.length > 0 || databaseItemIndex !== undefined) {
      const itemPreview: DialogItemPreview = {
        ...sourceElement.itemPreview,
        ...(databaseItemIndex !== undefined ? {
          itemIndex: databaseItemIndex,
          label: `物品 IDX ${databaseItemIndex}`,
        } : {}),
      };
      delete itemPreview.dynamic;
      delete itemPreview.dynamicFields;
      if (sourceDynamicFields.length > 0) {
        itemPreview.dynamic = true;
        itemPreview.dynamicFields = [...sourceDynamicFields];
      }
      const warning = databaseItemIndex === undefined
        ? mergeWarningClauses(bound.warning, sourceElement.warning)
        : mergeWarningClauses(
          withoutItemShowDynamicWarning(bound.warning),
          withoutItemShowDynamicWarning(sourceElement.warning),
          sourceDynamicFields.length > 0
            ? `ItemShow 的 ${sourceDynamicFields.join('、')} 包含动态值，静态预览仅绘制可确定部分，不把变量默认值冒充运行时结果`
            : undefined
        );
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        assetRef: sourceElement.assetRef,
        assetLayers: sourceElement.assetLayers,
        itemPreview,
        width: sourceElement.width,
        height: sourceElement.height,
        sizePreview: sourceElement.sizePreview,
        warning,
      };
    }
  }
  if (
    bound.imagePreview?.variant === 'newui-img-996pc'
    && sourceElement.imagePreview?.variant === 'newui-img-996pc'
  ) {
    const imagePreview: DialogImagePreview = {
      ...sourceElement.imagePreview,
      ...(sourceElement.imagePreview.scale9
        ? { scale9: { ...sourceElement.imagePreview.scale9 } }
        : {}),
      ...(sourceElement.imagePreview.directPathPreview
        ? { directPathPreview: { ...sourceElement.imagePreview.directPathPreview } }
        : {}),
      ...(sourceElement.imagePreview.defaultFields?.length
        ? { defaultFields: [...sourceElement.imagePreview.defaultFields] }
        : {}),
      ...(sourceElement.imagePreview.dynamicFields?.length
        ? { dynamicFields: [...sourceElement.imagePreview.dynamicFields] }
        : {}),
      ...(sourceElement.imagePreview.invalidFields?.length
        ? { invalidFields: [...sourceElement.imagePreview.invalidFields] }
        : {}),
    };
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      imagePreview,
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (
    bound.imagePreview
    && sourceElement.imagePreview
    && sourceElement.imagePreview.variant !== 'newui-img-996pc'
  ) {
    const dynamicFields = [...new Set([
      ...(bound.imagePreview.dynamicFields || []),
      ...(sourceElement.imagePreview.dynamicFields || []),
    ])];
    const invalidFields = [...new Set([
      ...(bound.imagePreview.invalidFields || []),
      ...(sourceElement.imagePreview.invalidFields || []),
    ])];
    if (dynamicFields.length > 0 || invalidFields.length > 0) {
      const imagePreview: DialogImagePreview = {
        ...bound.imagePreview,
        ...(dynamicFields.length > 0 ? { dynamic: true, dynamicFields } : {}),
        ...(invalidFields.length > 0 ? { invalidFields } : {}),
      };
      if (dynamicFields.includes('opacity')) {
        imagePreview.opacity = sourceElement.imagePreview.opacity;
      }
      if (dynamicFields.includes('gray')) {
        imagePreview.gray = sourceElement.imagePreview.gray;
      }
      if (dynamicFields.includes('background')) {
        if (sourceElement.imagePreview.background) imagePreview.background = true;
        else delete imagePreview.background;
      }
      if (dynamicFields.includes('show-position')) {
        if (sourceElement.imagePreview.showPosition !== undefined) {
          imagePreview.showPosition = sourceElement.imagePreview.showPosition;
        } else {
          delete imagePreview.showPosition;
        }
      }
      if (dynamicFields.some(field => field.startsWith('scale9-'))) {
        if (sourceElement.imagePreview.scale9) {
          imagePreview.scale9 = { ...sourceElement.imagePreview.scale9 };
        } else {
          delete imagePreview.scale9;
        }
      }
      if (dynamicFields.includes('title') || invalidFields.includes('title')) {
        if (sourceElement.imagePreview.title) {
          imagePreview.title = { ...sourceElement.imagePreview.title };
        } else {
          delete imagePreview.title;
        }
      }
      if (dynamicFields.includes('submit') || invalidFields.includes('submit')) {
        if (sourceElement.imagePreview.submitIds) {
          imagePreview.submitIds = sourceElement.imagePreview.submitIds;
        } else {
          delete imagePreview.submitIds;
        }
      }
      if (dynamicFields.includes('link')) {
        if (sourceElement.imagePreview.link) imagePreview.link = sourceElement.imagePreview.link;
        else delete imagePreview.link;
      }
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        imagePreview,
        warning: mergeWarningClauses(
          bound.warning,
          sourceElement.warning
        ),
      };
    }
  }
  if (bound.progressPreview && sourceElement.progressPreview) {
    const sourceProgress = sourceElement.progressPreview;
    const progressPreview: DialogProgressPreview = {
      ...sourceProgress,
      ...(sourceProgress.defaultFields
        ? { defaultFields: [...sourceProgress.defaultFields] }
        : {}),
      ...(sourceProgress.dynamicFields
        ? { dynamicFields: [...sourceProgress.dynamicFields] }
        : {}),
      ...(sourceProgress.invalidFields
        ? { invalidFields: [...sourceProgress.invalidFields] }
        : {}),
    };
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      assetRef: sourceElement.assetRef,
      assetLayers: sourceElement.assetLayers,
      progressPreview,
      warning: mergeWarningClauses(
        bound.warning,
        sourceElement.warning
      ),
    };
  }
  if (bound.togglePreview && sourceElement.togglePreview) {
    const dynamicFields = [...new Set([
      ...(bound.togglePreview.dynamicFields || []),
      ...(sourceElement.togglePreview.dynamicFields || []),
    ])];
    const invalidFields = [...new Set([
      ...(bound.togglePreview.invalidFields || []),
      ...(sourceElement.togglePreview.invalidFields || []),
    ])];
    if (dynamicFields.length > 0 || invalidFields.length > 0) {
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        togglePreview: {
          ...sourceElement.togglePreview,
          ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
          ...(invalidFields.length > 0 ? { invalidFields } : {}),
        },
        warning: mergeWarningClauses(
          bound.warning,
          sourceElement.warning
        ),
      };
    }
  }
  if (bound.sliderPreview && sourceElement.sliderPreview) {
    const dynamicFields = [...new Set([
      ...(bound.sliderPreview.dynamicFields || []),
      ...(sourceElement.sliderPreview.dynamicFields || []),
    ])];
    const invalidFields = [...new Set([
      ...(bound.sliderPreview.invalidFields || []),
      ...(sourceElement.sliderPreview.invalidFields || []),
    ])];
    if (dynamicFields.length > 0 || invalidFields.length > 0) {
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        sliderPreview: {
          ...sourceElement.sliderPreview,
          ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
          ...(invalidFields.length > 0 ? { invalidFields } : {}),
        },
        // Preserve the source-safe ratio instead of a temporarily resolved runtime value.
        progressPreview: sourceElement.progressPreview
          ? { ...sourceElement.progressPreview }
          : bound.progressPreview,
        warning: mergeWarningClauses(
          bound.warning,
          sourceElement.warning
        ),
      };
    }
  }
  if (bound.countdownPreview && sourceElement.countdownPreview) {
    const sourceSensitive = Boolean(
      sourceElement.countdownPreview.dynamicFields?.length
      || sourceElement.countdownPreview.invalidFields?.length
    );
    if (sourceSensitive) {
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        countdownPreview: { ...sourceElement.countdownPreview },
        text: sourceElement.countdownPreview.initialText,
        ...(sourceElement.textPreview ? { textPreview: sourceElement.textPreview } : {}),
        ...(sourceElement.imageTextPreview
          ? { imageTextPreview: sourceElement.imageTextPreview }
          : {}),
        warning: mergeWarningClauses(
          bound.warning,
          sourceElement.warning
        ),
      };
    }
  }
  if (bound.animationPreview && sourceElement.animationPreview) {
    const sourceSensitive = Boolean(
      sourceElement.animationPreview.dynamicFields?.length
      || sourceElement.animationPreview.invalidFields?.length
    );
    if (sourceSensitive) {
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        animationPreview: { ...sourceElement.animationPreview },
        assetRef: sourceElement.assetRef,
        warning: mergeWarningClauses(
          bound.warning,
          sourceElement.warning
        ),
      };
    }
  }
  if (bound.modelPreview && sourceElement.modelPreview) {
    const sourceSensitive = Boolean(
      sourceElement.modelPreview.dynamicFields?.length
      || sourceElement.modelPreview.invalidFields?.length
    );
    if (sourceSensitive) {
      bound = {
        ...bound,
        parameters: sourceElement.parameters,
        modelPreview: {
          ...sourceElement.modelPreview,
          layers: sourceElement.modelPreview.layers.map(layer => ({ ...layer })),
          ...(sourceElement.modelPreview.effectConfigs
            ? { effectConfigs: { ...sourceElement.modelPreview.effectConfigs } }
            : {}),
          ...(sourceElement.modelPreview.dynamicFields?.length
            ? { dynamicFields: [...sourceElement.modelPreview.dynamicFields] }
            : {}),
          ...(sourceElement.modelPreview.invalidFields?.length
            ? { invalidFields: [...sourceElement.modelPreview.invalidFields] }
            : {}),
        },
        width: sourceElement.width,
        height: sourceElement.height,
        sizePreview: sourceElement.sizePreview,
        warning: [...new Set([
          bound.warning,
          sourceElement.warning,
        ].filter((value): value is string => Boolean(value)))].join('；') || undefined,
      };
    }
  }
  bound = bindTypedDisplayValues(bound, preview, sourceElement, variables);
  if (bound.textPreview && sourceElement.textPreview) {
    const sourceDynamicFields = sourceElement.textPreview.dynamicFields || [];
    const fieldSources = textFieldSourceDiagnostics(
      sourceElement,
      bound,
      variables
    );
    const fieldStatus = new Map(fieldSources.map(diagnostic => [
      diagnostic.field,
      diagnostic.status,
    ]));
    const resolvedSourceFields = fieldSources
      .filter(diagnostic => diagnostic.status === 'resolved-static')
      .map(diagnostic => diagnostic.field);
    const runtimeSourceFields = fieldSources
      .filter(diagnostic => diagnostic.status === 'runtime-placeholder')
      .map(diagnostic => diagnostic.field);
    const invalidStaticFields: NonNullable<DialogTextPreview['invalidFields']> = fieldSources
      .filter((diagnostic): diagnostic is DialogTextFieldSourceDiagnostic & {
        field: NonNullable<DialogTextPreview['invalidFields']>[number];
      } => diagnostic.status === 'invalid-static' && diagnostic.field !== 'text')
      .map(diagnostic => diagnostic.field);
    const resolvedFields = [...new Set<DialogTextPreviewField>([
      ...(bound.textPreview.resolvedFields || []),
      ...resolvedSourceFields,
    ])];
    const dynamicFields = [...new Set([
      ...(bound.textPreview.dynamicFields || []),
      ...runtimeSourceFields,
    ])].filter(field => (
      !resolvedFields.includes(field)
      && (field === 'text' || !invalidStaticFields.includes(field))
    ));
    const invalidFields: NonNullable<DialogTextPreview['invalidFields']> = [...new Set([
      ...(bound.textPreview.invalidFields || []).filter(field => (
        !sourceDynamicFields.includes(field)
        || fieldStatus.get(field) === 'invalid-static'
      )),
      ...(sourceElement.textPreview.invalidFields || []).filter(field => (
        !sourceDynamicFields.includes(field)
      )),
      ...invalidStaticFields,
    ])];
    const textPreview: DialogTextPreview = {
      ...bound.textPreview,
    };
    delete textPreview.dynamicFields;
    delete textPreview.invalidFields;
    delete textPreview.resolvedFields;
    delete textPreview.fieldSources;
    if (dynamicFields.length > 0) textPreview.dynamicFields = dynamicFields;
    if (invalidFields.length > 0) textPreview.invalidFields = invalidFields;
    if (resolvedFields.length > 0) textPreview.resolvedFields = resolvedFields;
    if (fieldSources.length > 0) textPreview.fieldSources = fieldSources;
    const textSource = fieldSources.find(diagnostic => diagnostic.field === 'text');
    if (textSource) textPreview.textValueStatus = textSource.status;
    if (dynamicFields.includes('simplify-number')) delete textPreview.simplifyNumber;
    if (dynamicFields.includes('simplify-number')) {
      delete textPreview.simplifyNumberApproximate;
    }
    if (dynamicFields.includes('color')) {
      delete textPreview.color;
      delete textPreview.colorValues;
      delete textPreview.colorFrames;
      delete textPreview.colorIntervalMs;
    }
    if (dynamicFields.includes('font-size')) delete textPreview.fontSize;
    if (dynamicFields.includes('font-family')) delete textPreview.fontFamily;
    if (dynamicFields.includes('font-bold')) delete textPreview.bold;
    if (dynamicFields.includes('gray')) delete textPreview.gray;
    if (dynamicFields.includes('outline-width')) delete textPreview.outlineWidth;
    if (dynamicFields.includes('outline-color')) delete textPreview.outlineColor;
    if (dynamicFields.includes('scroll-width')) delete textPreview.scrollWidth;
    if (dynamicFields.includes('scroll-height')) delete textPreview.scrollHeight;
    if (dynamicFields.includes('scroll-direction')) delete textPreview.scrollDirection;
    if (dynamicFields.includes('scroll-duration')) delete textPreview.scrollDurationMs;
    if (invalidFields.includes('scroll-width')) delete textPreview.scrollWidth;
    if (invalidFields.includes('scroll-height')) delete textPreview.scrollHeight;
    if (invalidFields.includes('scroll-direction')) delete textPreview.scrollDirection;
    if (invalidFields.includes('scroll-duration')) delete textPreview.scrollDurationMs;
    if (invalidFields.includes('simplify-number')) {
      delete textPreview.simplifyNumber;
      delete textPreview.simplifyNumberApproximate;
    }
    if (invalidFields.includes('font-size')) delete textPreview.fontSize;
    if (invalidFields.includes('font-family')) delete textPreview.fontFamily;
    if (invalidFields.includes('font-bold')) delete textPreview.bold;
    if (invalidFields.includes('gray')) delete textPreview.gray;
    if (invalidFields.includes('outline-width')) delete textPreview.outlineWidth;
    if (invalidFields.includes('outline-color')) delete textPreview.outlineColor;
    if (invalidFields.includes('color')) {
      delete textPreview.color;
      delete textPreview.colorValues;
      delete textPreview.colorFrames;
      delete textPreview.colorIntervalMs;
    }
    const sourceRText = sourceElement.statementId === 'newui-rtext-996pc';
    const sourceScrollWidthUnsafe = sourceRText
      && (dynamicFields.includes('scroll-width') || invalidFields.includes('scroll-width'));
    const sourceScrollHeightUnsafe = sourceRText
      && (dynamicFields.includes('scroll-height') || invalidFields.includes('scroll-height'));
    const sourceSafeScrollSize = (sourceScrollWidthUnsafe || sourceScrollHeightUnsafe)
      && sourceElement.sizePreview
      ? {
        width: sourceScrollWidthUnsafe
          ? { ...sourceElement.sizePreview.width }
          : { ...(bound.sizePreview?.width || sourceElement.sizePreview.width) },
        height: sourceScrollHeightUnsafe
          ? { ...sourceElement.sizePreview.height }
          : { ...(bound.sizePreview?.height || sourceElement.sizePreview.height) },
      }
      : undefined;
    bound = {
      ...bound,
      parameters: sourceElement.parameters,
      textPreview,
      ...(sourceScrollWidthUnsafe ? { width: sourceElement.width } : {}),
      ...(sourceScrollHeightUnsafe ? { height: sourceElement.height } : {}),
      ...(sourceSafeScrollSize ? { sizePreview: sourceSafeScrollSize } : {}),
      color: dynamicFields.includes('color') ? sourceElement.color : bound.color,
      warning: mergeWarningClauses(
        runtimeSourceFields.some(field => (
          field !== 'text' && bound.textPreview?.invalidFields?.includes(field)
        ))
          ? sourceElement.warning
          : bound.warning,
        dynamicFields.length > 0 || invalidFields.length > 0
          ? sourceElement.warning
          : undefined,
        dynamicFields.length > 0
          ? `未确定文字/样式字段 ${dynamicFields.join('、')} 使用中性占位；确定字段仍按当前静态路径绘制`
          : undefined
      ),
      };
  }
  const sourceWidthDynamic = sourceElement.sizePreview?.width.mode === 'dynamic'
    && !bound.textPreview?.resolvedFields?.includes('scroll-width');
  const sourceHeightDynamic = sourceElement.sizePreview?.height.mode === 'dynamic'
    && !bound.textPreview?.resolvedFields?.includes('scroll-height');
  if (sourceWidthDynamic || sourceHeightDynamic) {
    const widthAxis = sourceWidthDynamic
      ? sourceElement.sizePreview!.width
      : bound.sizePreview?.width ?? sourceElement.sizePreview!.width;
    const heightAxis = sourceHeightDynamic
      ? sourceElement.sizePreview!.height
      : bound.sizePreview?.height ?? sourceElement.sizePreview!.height;
    const dynamicAxes = [
      sourceWidthDynamic ? 'width' : undefined,
      sourceHeightDynamic ? 'height' : undefined,
    ].filter((value): value is string => Boolean(value));
    bound = {
      ...bound,
      width: sourceWidthDynamic ? sourceElement.width : bound.width,
      height: sourceHeightDynamic ? sourceElement.height : bound.height,
      sizePreview: {
        width: { ...widthAxis },
        height: { ...heightAxis },
      },
      warning: mergeWarningClauses(
        bound.warning,
        `控件 ${dynamicAxes.join('/')} 尺寸来自动态表达式；Ctrl+F12 保留源码安全尺寸，不采用变量当前值`
      ),
    };
  }
  return bound;
}

/**
 * Restore only renderer-facing display values from the statically evaluated
 * preview. Resource identities, database IDs, geometry, runtime state and
 * actions remain on `bound`, which has already been rebuilt from the source
 * expression by the strict gates above.
 */
function bindTypedDisplayValues(
  bound: DialogElement,
  evaluated: DialogElement,
  sourceElement: DialogElement,
  variables: readonly DialogResolvedVariable[]
): DialogElement {
  if (!/<\$/i.test(sourceElement.raw)) return bound;
  let result = bound;
  const sources: Array<DialogDisplayValueSource | undefined> = [];
  const record = (
    field: string,
    kind: DialogDisplayValueSource['kind'],
    expression: string | undefined,
    value: string | number,
    invalid = false
  ): void => {
    sources.push(displayValueSource(field, kind, expression, value, variables, invalid));
  };

  const imageTextExpression = sourceElement.statementId.startsWith('image-number')
    ? sourceParameterValue(sourceElement, 2)
    : sourceElement.statementId === 'textatlas-996pc'
      ? sourceParameterValue(sourceElement, 5)
      : sourceElement.statementId === 'newui-textatlas-996pc'
        ? sourceParameterValue(sourceElement, 'text')
        : undefined;
  if (
    imageTextExpression && /<\$/i.test(imageTextExpression)
    && result.imageTextPreview && evaluated.imageTextPreview
  ) {
    const evaluatedValue = /^\d+$/u.test(evaluated.imageTextPreview.value)
      ? evaluated.imageTextPreview.value
      : '0';
    const assetsSafe = imageTextDisplayAssetsAreStatic(sourceElement);
    const sourceGlyphWidth = result.imageTextPreview.textAtlasVariant === 'newui-atlas'
      && Number.isSafeInteger(result.imageTextPreview.glyphWidth)
      && result.imageTextPreview.glyphWidth! > 0
      && !result.imageTextPreview.dynamicFields?.includes('glyph-width')
      && !result.imageTextPreview.invalidFields?.includes('glyph-width')
      ? result.imageTextPreview.glyphWidth
      : undefined;
    const glyphs = [...evaluatedValue].map((character, index) => {
      const glyph = evaluated.imageTextPreview!.glyphs[index] || { character };
      if (assetsSafe) return { ...glyph, character };
      return {
        character,
        // Cropping geometry belongs to the source-safe resource contract, not
        // to the display-value channel. Never retain sourceX calculated from
        // a temporarily resolved dynamic iwidth/MOV value.
        ...(sourceGlyphWidth !== undefined
          ? { sourceX: Number(character) * sourceGlyphWidth }
          : {}),
      };
    });
    const dynamicFields = [...new Set([
      ...(result.imageTextPreview.dynamicFields || []),
      'text' as const,
    ])];
    result = {
      ...result,
      text: evaluatedValue,
      imageTextPreview: {
        ...result.imageTextPreview,
        value: evaluatedValue,
        glyphs,
        dynamicFields,
      },
    };
    record('image-text-value', 'number', imageTextExpression, Number(evaluatedValue));
  }

  if (result.costItemPreview && evaluated.costItemPreview) {
    const titleExpression = sourceParameterValue(sourceElement, 'title');
    const quantityExpression = sourceParameterValue(sourceElement, 'itemcount');
    const title = titleExpression && /<\$/i.test(titleExpression)
      ? evaluated.costItemPreview.title || '预览文字'
      : result.costItemPreview.title;
    const quantityText = quantityExpression && /<\$/i.test(quantityExpression)
      ? (/^[+-]?\d+(?:\.\d+)?$/u.test(evaluated.costItemPreview.quantityText)
        ? evaluated.costItemPreview.quantityText
        : '0')
      : result.costItemPreview.quantityText;
    result = {
      ...result,
      text: title,
      costItemPreview: {
        ...result.costItemPreview,
        title,
        quantityText,
      },
    };
    if (titleExpression && /<\$/i.test(titleExpression)) {
      record('cost-title', 'text', titleExpression, title);
    }
    if (quantityExpression && /<\$/i.test(quantityExpression)) {
      record('cost-quantity', 'number', quantityExpression, Number(quantityText));
    }
  }

  if (result.inputPreview && evaluated.inputPreview) {
    const placeholderExpression = sourceParameterValue(sourceElement, 'place');
    const errorExpression = sourceParameterValue(sourceElement, 'errortips');
    const placeholder = placeholderExpression && /<\$/i.test(placeholderExpression)
      ? evaluated.inputPreview.placeholder || '预览文字'
      : result.inputPreview.placeholder;
    const errorTips = errorExpression && /<\$/i.test(errorExpression)
      ? evaluated.inputPreview.errorTips || '预览文字'
      : result.inputPreview.errorTips;
    result = {
      ...result,
      inputPreview: {
        ...result.inputPreview,
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...(errorTips !== undefined ? { errorTips } : {}),
      },
    };
    if (placeholderExpression && /<\$/i.test(placeholderExpression)) {
      record('input-placeholder', 'text', placeholderExpression, placeholder || '预览文字');
    }
    if (errorExpression && /<\$/i.test(errorExpression)) {
      record('input-error-tips', 'text', errorExpression, errorTips || '预览文字');
    }
  }

  if (result.menuPreview && evaluated.menuPreview) {
    const itemsExpression = sourceParameterValue(sourceElement, 'itemname');
    const selectedExpression = sourceParameterValue(sourceElement, 'select');
    const items = itemsExpression && /<\$/i.test(itemsExpression)
      ? (evaluated.menuPreview.items.length > 0
        ? [...evaluated.menuPreview.items]
        : ['预览文字'])
      : [...result.menuPreview.items];
    const selected = selectedExpression && /<\$/i.test(selectedExpression)
      ? evaluated.menuPreview.selected || '预览文字'
      : result.menuPreview.selected;
    result = {
      ...result,
      menuPreview: {
        ...result.menuPreview,
        items,
        selected,
      },
    };
    if (itemsExpression && /<\$/i.test(itemsExpression)) {
      record('menu-items', 'text', itemsExpression, items.join('#'));
    }
    if (selectedExpression && /<\$/i.test(selectedExpression)) {
      record('menu-selected', 'text', selectedExpression, selected);
    }
  }

  if (result.itemPreview && evaluated.itemPreview) {
    const itemIndexExpression = itemIndexSourceExpression(sourceElement);
    if (
      itemIndexExpression
      && /<\$/i.test(itemIndexExpression)
      && result.itemPreview.itemIndex !== undefined
    ) {
      record('item-index', 'number', itemIndexExpression, result.itemPreview.itemIndex);
    }
    const quantityExpression = sourceElement.statementId === 'newui-itemshow-996pc'
      ? sourceParameterValue(sourceElement, 'itemcount')
      : sourceElement.statementId === 'item-show'
        ? sourceParameterValue(sourceElement, 2)
        : undefined;
    if (quantityExpression && /<\$/i.test(quantityExpression)) {
      const quantity = Number.isFinite(evaluated.itemPreview.quantity)
        ? Number(evaluated.itemPreview.quantity)
        : 0;
      result = {
        ...result,
        itemPreview: {
          ...result.itemPreview,
          quantity,
        },
      };
      record('item-quantity', 'number', quantityExpression, quantity);
    }
  }

  if (result.countdownPreview && evaluated.countdownPreview) {
    const secondsExpression = sourceElement.statementId === 'newui-countdown-996pc'
      ? sourceParameterValue(sourceElement, 'time')
      : sourceParameterValue(sourceElement, 2);
    if (secondsExpression && /<\$/i.test(secondsExpression)) {
      const initialText = evaluated.countdownPreview.initialText || '0';
      const countdownPreview: DialogCountdownPreview = {
        ...result.countdownPreview,
        initialText,
      };
      // A proven display snapshot is not permission to start an offline timer.
      delete countdownPreview.seconds;
      result = {
        ...result,
        text: initialText,
        countdownPreview,
        ...(evaluated.textPreview ? {
          textPreview: cloneDialogTextPreview(evaluated.textPreview),
        } : {}),
      };
      const numericDisplay = Number((/^([+-]?\d+)/u.exec(initialText) || [])[1] || 0);
      record('countdown-seconds', 'number', secondsExpression, numericDisplay);
    }
  }

  if (result.progressPreview && evaluated.progressPreview) {
    const valueExpression = progressDisplayValueExpression(sourceElement);
    if (valueExpression && /<\$/i.test(valueExpression)) {
      const value = Number.isFinite(evaluated.progressPreview.value)
        ? Number(evaluated.progressPreview.value)
        : 0;
      const progressPreview: DialogProgressPreview = {
        ...result.progressPreview,
        value,
      };
      // Runtime progress state remains unknown even though its caption has a
      // useful source-derived display snapshot.
      delete progressPreview.ratio;
      result = { ...result, progressPreview };
      record('progress-value', 'number', valueExpression, value);
    }
    const textExpression = progressDisplayTextExpression(sourceElement);
    if (textExpression && /<\$/i.test(textExpression)) {
      const text = evaluated.progressPreview.text !== undefined
        ? evaluated.progressPreview.text
        : '预览文字';
      result = {
        ...result,
        progressPreview: {
          ...result.progressPreview!,
          text,
        },
      };
      record('progress-text', 'text', textExpression, text);
    }
  }

  if (result.imagePreview && evaluated.imagePreview) {
    const titleExpression = imageTitleSourceExpression(sourceElement);
    if (titleExpression && /<\$/i.test(titleExpression) && evaluated.imagePreview.title) {
      result = {
        ...result,
        imagePreview: {
          ...result.imagePreview,
          title: { ...evaluated.imagePreview.title },
        },
      };
      record('image-title', 'text', titleExpression, evaluated.imagePreview.title.text);
    }
  }

  if (result.animationPreview && evaluated.animationPreview) {
    const captionExpression = animationCaptionSourceExpression(sourceElement);
    if (captionExpression && /<\$/i.test(captionExpression)) {
      const animationPreview: DialogAnimationPreview = {
        ...result.animationPreview,
        ...(evaluated.animationPreview.caption !== undefined
          ? { caption: evaluated.animationPreview.caption }
          : {}),
        ...(evaluated.animationPreview.title
          ? { title: { ...evaluated.animationPreview.title } }
          : {}),
      };
      result = { ...result, animationPreview };
      const display = evaluated.animationPreview.title?.text
        || evaluated.animationPreview.caption
        || '预览文字';
      record('animation-title', 'text', captionExpression, display);
    }
  }

  if (result.tooltipPreview && evaluated.tooltipPreview && /<\$/i.test(result.tooltipPreview.raw)) {
    const tooltipExpression = result.tooltipPreview.raw;
    const tooltipPreview: DialogTooltipPreview = {
      ...result.tooltipPreview,
      lines: evaluated.tooltipPreview.lines.map(line => line.map(run => ({ ...run }))),
    };
    result = { ...result, tooltipPreview };
    record(
      'tooltip',
      'text',
      tooltipExpression,
      tooltipPreview.lines.map(line => line.map(run => run.text).join('')).join('\n')
    );
  }

  const displayValueSources = mergeDisplayValueSources(result.displayValueSources, sources);
  return {
    ...result,
    ...(displayValueSources ? { displayValueSources } : {}),
  };
}

function cloneDialogTextPreview(preview: DialogTextPreview): DialogTextPreview {
  return {
    ...preview,
    lines: preview.lines.map(line => line.map(run => ({ ...run }))),
    ...(preview.fieldSources
      ? { fieldSources: preview.fieldSources.map(source => ({ ...source })) }
      : {}),
    ...(preview.resolvedFields ? { resolvedFields: [...preview.resolvedFields] } : {}),
    ...(preview.dynamicFields ? { dynamicFields: [...preview.dynamicFields] } : {}),
    ...(preview.invalidFields ? { invalidFields: [...preview.invalidFields] } : {}),
  };
}

function imageTextDisplayAssetsAreStatic(element: DialogElement): boolean {
  if (element.statementId.startsWith('image-number')) {
    const base = sourceParameterValue(element, 1);
    return Boolean(base && !/<\$/i.test(base) && Number.isSafeInteger(Number(base)));
  }
  const preview = element.imageTextPreview;
  if (!preview?.textAtlasVariant || !preview.baseAssetRef) return false;
  const unsafe = new Set([
    ...(preview.dynamicFields || []),
    ...(preview.invalidFields || []),
  ]);
  return !['archive', 'image', 'glyph-width', 'glyph-height'].some(field => unsafe.has(
    field as DialogImageTextField
  ));
}

function progressDisplayValueExpression(element: DialogElement): string | undefined {
  return sourceParameterValue(element, 'startper')
    || sourceParameterValue(element, 'minvalue')
    || sourceParameterValue(element, 12);
}

function progressDisplayTextExpression(element: DialogElement): string | undefined {
  return element.statementId === 'progress-bar'
    ? sourceParameterValue(element, 17)
    : undefined;
}

function imageTitleSourceExpression(element: DialogElement): string | undefined {
  const value = element.imagePreview?.variant === 'gom-img'
    ? sourceParameterValue(element, 5)
    : element.imagePreview?.variant === 'gom-imgex'
      ? sourceParameterValue(element, 8)
      : undefined;
  return value === undefined ? undefined : stripValueSuffix(value).trim();
}

function animationCaptionSourceExpression(element: DialogElement): string | undefined {
  switch (element.animationPreview?.variant) {
    case 'gom-playimg': return sourceParameterValue(element, 9);
    case 'lfm-playimg': return sourceParameterValue(element, 8);
    case 'lfm-playimgex': return sourceParameterValue(element, 9);
    default: return undefined;
  }
}

function parseMarkupLine(
  source: string,
  line: ScriptLine,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  flow: FlowLayoutCursor
): { elements: DialogElement[]; unsupported: string[] } {
  const elements: DialogElement[] = [];
  const unsupported: string[] = [];
  let cursor = line.start;
  while (cursor < line.end) {
    const start = source.indexOf('<', cursor);
    if (start < 0 || start >= line.end) break;
    const end = findMarkupEnd(source, start, line.end);
    if (end <= start) {
      unsupported.push(source.slice(start, line.end));
      break;
    }
    const catalogFlow = parseCatalogFlowElement(
      source,
      line,
      start,
      end,
      offsets,
      schemasByToken
    );
    if (catalogFlow) {
      elements.push(catalogFlow);
      cursor = end;
      continue;
    }
    const flowTooltip = parseLegacyFlowTooltipElement(source, line, start, end, offsets);
    if (flowTooltip) {
      elements.push(flowTooltip);
      cursor = end;
      continue;
    }
    const tokenMatch = /^<&?[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(start, line.end));
    if (!tokenMatch) {
      cursor = start + 1;
      continue;
    }
    const token = tokenMatch[0];
    const candidates = schemasByToken.get(token.toUpperCase()) || [];
    const delimiter = source[start + token.length];
    const schema = selectStatementSchema(
      candidates,
      delimiter,
      source.slice(start, end)
    );
    if (!schema) {
      const raw = source.slice(start, end);
      unsupported.push(raw);
      elements.push(unknownStatementElement(source, line, start, end, token, raw, offsets));
      cursor = end;
      continue;
    }
    const element = parseStatement(source, line, start, end, token, schema, offsets);
    elements.push(element);
    cursor = end;
  }
  return {
    elements: layoutFlowLine(source, line, elements, flow),
    unsupported,
  };
}

function parseCatalogFlowElement(
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>
): DialogElement | undefined {
  const raw = source.slice(start, end);
  const inner = raw.slice(1, -1);
  const directive = findTopLevelSlashDirective(inner);
  if (!directive) return undefined;

  const tooltipPipe = findTopLevelPipe(inner);
  if (directive.name === '@' && tooltipPipe >= 0 && tooltipPipe < directive.index) {
    // Preserve the long-standing tooltip statement identity and let its parser
    // attach the same typed click action. The pipe belongs to the visible
    // tooltip grammar, not to a SCRIPTPARAM list.
    return undefined;
  }

  const visibleRaw = inner.slice(0, directive.index).trim();
  // A real command such as <IMG:.../@Label> stays on the normal statement
  // path. This parser is exclusively for user-text-first legacy flow markup.
  if (!visibleRaw || /^&?[A-Za-z_][A-Za-z0-9_.]*\s*[:|]/.test(visibleRaw)) {
    return undefined;
  }

  const layoutX = offsets.menuX + 18;
  const layoutY = offsets.menuY + 24;
  const text = cleanFlowTextFragment(visibleRaw);
  const width = Math.max(6, flowTextWidth(text));
  const base = {
    id: `${start}:catalog-flow`,
    kind: 'text' as const,
    raw,
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: 'flow' as const,
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: layoutX,
    localLayoutY: layoutY,
    layoutX,
    layoutY,
    width,
    height: 20,
    text,
  };

  if (directive.name === '@') {
    const actionSource = inner.slice(directive.index + 1).trim();
    const action = parseLegacyClickAction(actionSource);
    const statementId = action.parameterized ? 'text-link-params' : 'text-link';
    const schema = flowCatalogSchema(schemasByToken, statementId);
    if (!schema) return undefined;
    const uncertain = Boolean(
      action.preview.dynamicFields?.length || action.preview.invalidFields?.length
    );
    return {
      ...base,
      id: `${start}:${statementId}`,
      statementId,
      token: schema.token,
      description: schema.description,
      runtimeActionPreview: action.preview,
      warning: [
        '传统流式文字没有独立 X/Y，位置由客户端列表布局决定',
        '点击标签和 SCRIPTPARAM 仅作本地预览，不提交服务器，也不执行 @ 标签',
        uncertain
          ? '动态或无效动作字段不借用 MOV 当前值，相关本地动作已禁用'
          : undefined,
      ].filter(Boolean).join('；'),
    };
  }

  if (directive.name !== 'FCOLOR') return undefined;
  if (
    source.slice(line.start, start).trim()
    || source.slice(end, line.end).trim()
  ) {
    // When colored markup is embedded among other flow fragments, the whole
    // physical line must remain one run sequence so text before/after it is not
    // split into unrelated elements. A standalone catalog statement still
    // receives the precise text-color identity below.
    return undefined;
  }
  const schema = flowCatalogSchema(schemasByToken, 'text-color');
  if (!schema) return undefined;
  const colorSource = inner.slice(directive.valueStart).trim();
  const dynamicColor = /<\$/i.test(colorSource);
  const run = dynamicColor
    ? { text }
    : dialogTextRun(text, colorSource, 'FCOLOR');
  const invalidColor = !dynamicColor && !run.color;
  const textPreview: DialogTextPreview = {
    lines: [[run]],
    align: 'left',
    ...(run.color ? { color: run.color } : {}),
    ...(dynamicColor ? { dynamicFields: ['color'] } : {}),
    ...(invalidColor ? { invalidFields: ['color'] } : {}),
  };
  return {
    ...base,
    id: `${start}:text-color`,
    statementId: 'text-color',
    token: schema.token,
    description: schema.description,
    ...(run.color ? { color: run.color } : {}),
    textPreview,
    warning: [
      '传统流式文字没有独立 X/Y，位置由客户端列表布局决定',
      dynamicColor ? '文字颜色是动态表达式；静态预览不借用 MOV 当前值' : undefined,
      invalidColor ? '文字颜色参数无效；已保留文字并锁定颜色语义' : undefined,
    ].filter(Boolean).join('；'),
  };
}

function flowCatalogSchema(
  schemasByToken: Map<string, DialogStatementSchema[]>,
  id: 'text-link' | 'text-link-params' | 'text-color'
): DialogStatementSchema | undefined {
  const token = id === 'text-link'
    ? '<FLOW_TEXT_LINK'
    : id === 'text-link-params'
      ? '<FLOW_TEXT_LINK_PARAMS'
      : '<FLOW_TEXT_COLOR';
  return schemasByToken.get(token)?.find(schema => schema.id === id);
}

function parseLegacyClickAction(value: string): {
  preview: DialogRuntimeActionPreview;
  parameterized: boolean;
} {
  const actionEnd = findTopLevelCharacter(value, '|');
  const action = (actionEnd >= 0 ? value.slice(0, actionEnd) : value).trim();
  const parameterStart = findTopLevelCharacter(action, '(');
  const parameterized = parameterStart >= 0 && action.endsWith(')');
  const linkSource = (parameterized ? action.slice(0, parameterStart) : action).trim();
  const parameterSource = parameterized
    ? action.slice(parameterStart + 1, -1)
    : undefined;
  const preview: DialogRuntimeActionPreview = {
    trigger: 'click',
    localOnly: true,
  };
  const dynamicFields: NonNullable<DialogRuntimeActionPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogRuntimeActionPreview['invalidFields']> = [];

  if (/<\$/i.test(linkSource)) dynamicFields.push('link');
  else if (/^@\S+$/u.test(linkSource)) preview.link = linkSource;
  else invalidFields.push('link');

  if (parameterized) {
    const parameters = splitTopLevelText(parameterSource || '', ',').map(part => part.trim());
    preview.parameters = parameters;
    if (parameters.some(parameter => /<\$/i.test(parameter))) {
      dynamicFields.push('link-parameters');
    }
    if (parameters.length === 0 || parameters.some(parameter => !parameter)) {
      invalidFields.push('link-parameters');
    }
  }
  if (dynamicFields.length) preview.dynamicFields = [...new Set(dynamicFields)];
  if (invalidFields.length) preview.invalidFields = [...new Set(invalidFields)];
  return { preview, parameterized };
}

function selectStatementSchema(
  candidates: DialogStatementSchema[],
  delimiter: string | undefined,
  raw: string
): DialogStatementSchema | undefined {
  const syntax = delimiter === '|' ? 'key-value'
    : delimiter === ':' ? 'positional' : undefined;
  const compatible = syntax
    ? candidates.filter(candidate => candidate.syntax === syntax)
    : candidates;
  if (compatible.length <= 1) return compatible[0] || candidates[0];

  // Some legacy manuals publish suffix variants under the same token and the
  // same positional syntax (notably IMG vs IMG-with-remark and TEXT vs
  // TEXT-with-link). A first-match lookup makes every later variant
  // unreachable. Match the observable top-level suffix against the declared
  // parameter meaning, while keeping catalog order as the deterministic tie
  // breaker for genuinely indistinguishable historical variants.
  const inner = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  const hasRemark = findTopLevelPipe(inner) >= 0;
  const hasLink = /\/@[^|>{}\s]+/i.test(raw);
  const ranked = compatible.map((candidate, index) => {
    const meanings = [...candidate.parameterMeanings.values()].join(' ');
    const declaresRemark = /备注/.test(meanings);
    const declaresLink = /标签/.test(meanings);
    let score = 0;
    score += hasRemark === declaresRemark ? 4 : -4;
    score += hasLink === declaresLink ? 4 : -4;
    return { candidate, index, score };
  });
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.candidate || compatible[0] || candidates[0];
}

function unknownStatementElement(
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  token: string,
  raw: string,
  offsets: NpcDialogOffsets
): DialogElement {
  const layoutX = offsets.menuX + 18;
  const layoutY = offsets.menuY + 24;
  return {
    id: `${start}:unsupported`,
    statementId: 'unsupported',
    token,
    description: '尚未确认的界面语句',
    kind: 'unknown',
    raw,
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: 'flow',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: layoutX,
    localLayoutY: layoutY,
    layoutX,
    layoutY,
    width: 150,
    height: 30,
    text: token.replace(/^<&?/, ''),
    warning: '未确认参数语义，已锁定并原样保留源码',
  };
}

function parseLegacyFlowTooltipElement(
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  offsets: NpcDialogOffsets
): DialogElement | undefined {
  const raw = source.slice(start, end);
  const inner = raw.slice(1, -1);
  const pipe = findTopLevelPipe(inner);
  if (pipe < 0) return undefined;
  const visibleRaw = inner.slice(0, pipe).trim();
  const tooltipRaw = inner.slice(pipe + 1).trim();
  if (
    !visibleRaw
    || /^&?[A-Za-z_][A-Za-z0-9_.]*:/.test(visibleRaw)
    || /^&?[A-Za-z_][A-Za-z0-9_.]*\s*=/.test(tooltipRaw)
  ) return undefined;
  const tooltipPreview = parseDialogTooltipPreview(tooltipRaw, 0, 0);
  if (!tooltipPreview) return undefined;
  const actionDirective = findTopLevelSlashDirective(inner);
  const runtimeActionPreview = actionDirective?.name === '@'
    ? parseLegacyClickAction(inner.slice(actionDirective.index + 1)).preview
    : undefined;
  const text = cleanFlowTextFragment(visibleRaw.replace(/\s*\/@[^\s>]+.*$/, ''));
  const width = Math.max(6, flowTextWidth(text));
  const layoutX = offsets.menuX + 18;
  const layoutY = offsets.menuY + 24;
  return {
    id: `${start}:flow-text-tooltip`,
    statementId: 'flow-text-tooltip',
    token: '<文字备注>',
    description: '带鼠标悬停备注的传统 NPC 文字',
    kind: 'text',
    raw,
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: 'flow',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: layoutX,
    localLayoutY: layoutY,
    layoutX,
    layoutY,
    width,
    height: 20,
    text,
    tooltipPreview,
    ...(runtimeActionPreview ? { runtimeActionPreview } : {}),
    warning: [
      '传统流式文字没有独立 X/Y，位置由客户端列表布局决定',
      runtimeActionPreview
        ? '点击标签仅作本地预览，不提交服务器，也不执行 @ 标签'
        : undefined,
    ].filter(Boolean).join('；'),
  };
}

function createFlowLayoutCursor(offsets: NpcDialogOffsets): FlowLayoutCursor {
  const originX = offsets.menuX + 18;
  return {
    originX,
    x: originX,
    y: offsets.menuY + 24,
    lineHeight: 22,
  };
}

function layoutFlowLine(
  source: string,
  line: ScriptLine,
  parsedElements: DialogElement[],
  flow: FlowLayoutCursor
): DialogElement[] {
  const result: DialogElement[] = [];
  const ordered = [...parsedElements].sort((left, right) => (
    left.sourceRange.start - right.sourceRange.start
  ));
  let cursor = line.start;
  for (const element of ordered) {
    appendFlowTextFragments(result, source, line, cursor, element.sourceRange.start, flow);
    if (element.coordinateMode === 'flow') {
      element.localLayoutX = flow.x;
      element.localLayoutY = flow.y;
      element.layoutX = flow.x;
      element.layoutY = flow.y;
      advanceFlowCursor(flow, element.width, element.height);
    }
    result.push(element);
    cursor = element.sourceRange.end;
  }
  appendFlowTextFragments(result, source, line, cursor, line.end, flow);
  return result;
}

function appendFlowTextFragments(
  result: DialogElement[],
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  flow: FlowLayoutCursor
): void {
  let fragmentStart = start;
  for (let cursor = start; cursor < end; cursor++) {
    if (source[cursor] !== '\\') continue;
    appendFlowTextFragment(result, source, line, fragmentStart, cursor, flow);
    breakFlowLine(flow);
    fragmentStart = cursor + 1;
  }
  appendFlowTextFragment(result, source, line, fragmentStart, end, flow);
}

function appendFlowTextFragment(
  result: DialogElement[],
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  flow: FlowLayoutCursor
): void {
  if (end <= start) return;
  const raw = source.slice(start, end);
  const content = flowTextContent(raw);
  const text = content.text;
  const width = flowTextWidth(text);
  if (text.trim()) {
    result.push(flowTextElement(
      source,
      line,
      start,
      end,
      text,
      flow,
      width,
      content.runs
    ));
  }
  advanceFlowCursor(flow, width, 20);
}

function flowTextContent(value: string): { text: string; runs?: DialogTextRun[] } {
  const runs: DialogTextRun[] = [];
  const inline = new RegExp(
    `<([^<>]*?)\\/(FCOLOR|SCOLOR|AUTOCOLOR)\\s*=\\s*(${DIALOG_COLOR_LIST_PATTERN})\\s*>`,
    'gi'
  );
  let cursor = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  const append = (raw: string, color?: string) => {
    const text = cleanFlowTextFragment(raw);
    if (!text) return;
    runs.push({ text, ...(color ? { color } : {}) });
  };

  while ((match = inline.exec(value)) !== null) {
    matched = true;
    if (match.index > cursor) append(value.slice(cursor, match.index));
    const text = cleanFlowTextFragment(match[1]);
    if (text) runs.push(dialogTextRun(text, match[3], match[2]));
    cursor = match.index + match[0].length;
  }
  if (!matched) return { text: cleanFlowTextFragment(value) };
  if (cursor < value.length) append(value.slice(cursor));
  return {
    text: runs.map(run => run.text).join(''),
    ...(runs.length > 0 ? { runs } : {}),
  };
}

function cleanFlowTextFragment(value: string): string {
  return value
    .replace(/&(?:#x20|nbsp);/gi, ' ')
    .replace(
      new RegExp(
        `<([^<>]*?)\\/(?:FCOLOR|SCOLOR|AUTOCOLOR)\\s*=\\s*(?:${DIALOG_COLOR_LIST_PATTERN})\\s*>`,
        'gi'
      ),
      '$1'
    )
    .replace(/<([^<>]+?)(?:\/@[^>]*)?>/g, '$1')
    .replace(/<\$([^>]+)>/g, '{$$$1}');
}

function flowTextWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (character === '\t') width += 24;
    else if (character.charCodeAt(0) <= 0xff) width += 6;
    else width += 12;
  }
  return width;
}

function advanceFlowCursor(flow: FlowLayoutCursor, width: number, height: number): void {
  flow.x += Math.max(0, Math.ceil(width));
  flow.lineHeight = Math.max(flow.lineHeight, Math.max(20, Math.ceil(height)));
}

function breakFlowLine(flow: FlowLayoutCursor): void {
  flow.x = flow.originX;
  flow.y += Math.max(22, flow.lineHeight);
  flow.lineHeight = 22;
}

function parseStatement(
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  token: string,
  schema: DialogStatementSchema,
  offsets: NpcDialogOffsets
): DialogElement {
  const originalValues = parseStatementValues(source, start, end, token, schema.syntax);
  const binding = statementContainerBinding(originalValues, schema);
  const values = binding.shifted
    ? {
      positional: originalValues.positional.slice(1),
      keyed: originalValues.keyed,
      keyNames: originalValues.keyNames,
    }
    : originalValues;
  const xSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.xKey)
    : positionalValue(values, schema.xParameter);
  const ySpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.yKey)
    : positionalValue(values, schema.yParameter);
  const xNumber = numericValue(xSpan);
  const yNumber = numericValue(ySpan);
  const layoutPreview = statementLayoutPreview(values, schema);
  const coordinateMode = requiresStaticPositionLayout(layoutPreview)
    ? 'anchored'
    : xSpan && ySpan
    ? schema.absolute ? 'absolute' : 'relative'
    : 'flow';
  const nested = Boolean(binding.parentId);
  const displayOffsetX = coordinateMode === 'relative' && !nested ? offsets.memoX : 0;
  const displayOffsetY = coordinateMode === 'relative' && !nested ? offsets.memoY : 0;
  const x = xSpan && xNumber !== undefined
    ? coordinate(xSpan, xNumber, xNumber + displayOffsetX - schema.sourceCoordinateBiasX)
    : undefined;
  const y = ySpan && yNumber !== undefined
    ? coordinate(ySpan, yNumber, yNumber + displayOffsetY - schema.sourceCoordinateBiasY)
    : undefined;

  const widthSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.widthKey)
    : positionalValue(values, schema.widthParameter);
  const heightSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.heightKey)
    : positionalValue(values, schema.heightParameter);
  const kind = statementKind(schema.id, token);
  const defaults = defaultElementSize(kind);
  const textSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.textKey)
    : positionalValue(values, schema.textParameter);
  const declaredAssetRef = statementAssetReference(values, schema);
  const controlPreview = statementControlPreview(values, schema, declaredAssetRef);
  const monsterControl = statementMonsterControl(values, schema);
  if (monsterControl) {
    controlPreview.monsterPreview = monsterControl.preview;
    controlPreview.warning = [controlPreview.warning, monsterControl.warning]
      .filter(Boolean)
      .join('；') || undefined;
  }
  const itemBoxBackgroundBlocked = controlPreview.itemPreview?.mode === 'empty-box'
    && (
      controlPreview.itemPreview.backgroundDisabled === true
      || controlPreview.itemPreview.dynamicFields?.includes('background')
      || controlPreview.itemPreview.invalidFields?.includes('background')
    );
  const normalState = controlPreview.assetStateDiagnostics
    ?.find(candidate => candidate.role === 'normal');
  const menuBackground = controlPreview.menuPreview?.assetDiagnostics
    .find(candidate => candidate.role === 'background');
  const statefulAssetRef = controlPreview.menuPreview
    ? (menuBackground?.sourceStatus === 'default' || menuBackground?.sourceStatus === 'static')
      ? menuBackground.assetRef
      : undefined
    : controlPreview.assetStateDiagnostics
      ? normalState?.status === 'static' ? normalState.assetRef : undefined
      : declaredAssetRef;
  const assetRef = (itemBoxBackgroundBlocked ? undefined : statefulAssetRef)
    || monsterControl?.assetRef;
  const tooltipPreview = statementTooltipPreview(values, schema);
  if (binding.shifted && binding.raw) {
    controlPreview.parameters.unshift({
      index: 1,
      name: '父子容器',
      value: displayParameterValue(binding.raw.raw),
    });
    for (const parameter of controlPreview.parameters.slice(1)) {
      if (parameter.index !== undefined) parameter.index++;
    }
  }
  const raw = source.slice(start, end);
  const staticPositionLayout = requiresStaticPositionLayout(layoutPreview);
  const showPositionedBackground = Boolean(
    controlPreview.imagePreview?.background
    && controlPreview.imagePreview.showPosition !== undefined
  );
  const imageDynamicFields = controlPreview.imagePreview?.dynamicFields || [];
  const imageInvalidFields = controlPreview.imagePreview?.invalidFields || [];
  const imageUncertainFields = [...imageDynamicFields, ...imageInvalidFields];
  const uncertainBackgroundShowPlacement = Boolean(
    keyedValue(values, 'show')
    && (
      imageUncertainFields.includes('background')
      || (
        controlPreview.imagePreview?.background
        && imageUncertainFields.includes('show-position')
      )
    )
  );
  const safeDirectEdit = Boolean(x && y)
    && !staticPositionLayout
    && !showPositionedBackground
    && !uncertainBackgroundShowPlacement;
  const legacyCentered = Boolean(layoutPreview?.legacyCenterX || layoutPreview?.legacyCenterY);
  const unsupportedGeeLegacyCenter = schema.engine === 'GEE'
    && /^text-/.test(schema.id)
    && [xSpan, ySpan].some(value => value?.raw.trim().startsWith('*'));
  const layoutWarning = unsupportedGeeLegacyCenter
    ? 'GEE 当前手册未给出 Text * 居中坐标语义，未套用 GOM 的居中和偏移公式'
    : staticPositionLayout && legacyCentered
      ? layoutPreview?.legacyCenterDynamicAxes?.length
        || layoutPreview?.legacyCenterInvalidAxes?.length
        ? `GOM Text * 坐标已按官方居中规则绘制；${layoutPreview.legacyCenterDynamicAxes?.length ? '动态偏移未借用变量当前值' : '无效偏移已回退为 0'}；客户端对话框基准尺寸未公布，Ctrl+F12 按父容器或 800×600 预览范围定位并保持只读`
        : 'GOM Text * 坐标已按官方居中/偏移规则绘制；客户端对话框基准尺寸未公布，Ctrl+F12 按父容器或 800×600 预览范围定位并保持只读'
    : staticPositionLayout
      ? layoutPreview?.positionDynamic || layoutPreview?.sizeDynamic
        ? '996PC 动态锚点或百分比参数无法静态求值，已按可确定部分近似预览并保持只读'
        : '996PC 锚点或百分比布局已作静态近似预览，当前保持只读'
    : xSpan && ySpan && (!x || !y)
      ? '动态坐标暂不可编辑'
    : showPositionedBackground
      ? '996PC 背景 Img 使用 show 位置定位，预览忽略普通 X/Y 并保持只读'
    : uncertainBackgroundShowPlacement
      ? '996PC Img 的 bg 或 show 位置包含动态或无效值，X/Y 语义无法静态确定，当前保持只读'
    : layoutPreview?.sizeDynamic
      ? '996PC 动态百分比尺寸无法静态求值，已使用默认尺寸；坐标仍可编辑'
    : schema.compatibilityAlias
      ? '兼容的不带 & 相对坐标语句，预览已叠加 M2 修正值'
      : undefined;
  const warning = [layoutWarning, controlPreview.warning].filter(Boolean).join('；') || undefined;
  const localLayoutX = x?.displayValue ?? offsets.menuX + 18;
  const localLayoutY = y?.displayValue ?? offsets.menuY + 24;
  const grid = controlPreview.containerPreview?.variant === 'item-grid'
    ? controlPreview.containerPreview
    : undefined;
  // The engine manuals do not publish MText's exact font metrics. Ctrl+F12 uses
  // the existing 20px text preview box per documented row so later rows are not
  // clipped or excluded from selection geometry.
  const multilineTextHeight = schema.id === 'container-mtext'
    ? Math.max(1, controlPreview.textPreview?.lines.length ?? 1) * 20
    : undefined;
  // Text without an explicit viewport occupies its rendered glyph bounds in
  // the client. A fixed 160px wrapper made adjacent columns overlap and caused
  // clicks to select the wrong row/column, especially for short placeholders.
  const intrinsicTextSize = kind === 'text' && controlPreview.textPreview
    ? dialogTextPreviewSize(controlPreview.textPreview)
    : undefined;
  const elementWidth = numericValue(widthSpan)
    ?? controlPreview.textPreview?.scrollWidth
    ?? (controlPreview.itemPreview?.align === 'custom-width'
      ? controlPreview.itemPreview.customWidth ?? 40
      : undefined)
    ?? intrinsicTextSize?.width
    ?? (grid ? itemGridPreviewSize(grid, 'width') : defaults.width);
  const elementHeight = numericValue(heightSpan)
    ?? controlPreview.textPreview?.scrollHeight
    ?? multilineTextHeight
    ?? intrinsicTextSize?.height
    ?? (grid ? itemGridPreviewSize(grid, 'height') : defaults.height);
  const sizePreview = statementSizePreview(
    values,
    schema,
    widthSpan,
    heightSpan,
    elementWidth,
    elementHeight,
    Boolean(grid),
    Boolean(
      controlPreview.imageTextPreview
      || controlPreview.modelPreview
      || controlPreview.costItemPreview
      || assetRef
      || controlPreview.assetLayers?.some(layer => (
      layer.role === 'background' || layer.role === 'progress'
      ))
    )
  );

  return {
    id: `${start}:${schema.id}`,
    statementId: schema.id,
    token,
    description: schema.description,
    kind,
    raw,
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode,
    sourceCoordinateBiasX: schema.sourceCoordinateBiasX,
    sourceCoordinateBiasY: schema.sourceCoordinateBiasY,
    editable: safeDirectEdit,
    x,
    y,
    localLayoutX,
    localLayoutY,
    layoutX: localLayoutX,
    layoutY: localLayoutY,
    width: elementWidth,
    height: elementHeight,
    text: (['newui-rtext-996pc', 'container-mtext'].includes(schema.id) || /^text-/.test(schema.id))
      && controlPreview.textPreview
      ? controlPreview.textPreview.lines
        .map(line => line.map(run => run.text).join(''))
        .join('\n')
      : textSpan
      ? cleanDisplayText(textSpan.raw, schema.id === 'container-mtext')
      : controlPreview.imageTextPreview?.value
        || controlPreview.countdownPreview?.initialText
        || controlPreview.costItemPreview?.title
        || controlPreview.itemPreview?.label
        || fallbackElementText(kind, raw),
    color: controlPreview.textPreview?.color || (schema.syntax === 'key-value'
      ? statementValueColor(keyedValue(values, 'color'))
      : statementColor(raw)),
    parameters: controlPreview.parameters,
    assetRef,
    assetLayers: controlPreview.assetLayers,
    assetStateDiagnostics: controlPreview.assetStateDiagnostics,
    animationPreview: controlPreview.animationPreview,
    tooltipPreview,
    itemPreview: controlPreview.itemPreview,
    costItemPreview: controlPreview.costItemPreview,
    progressPreview: controlPreview.progressPreview,
    sliderPreview: controlPreview.sliderPreview,
    runtimeActionPreview: controlPreview.runtimeActionPreview,
    inputPreview: controlPreview.inputPreview,
    togglePreview: controlPreview.togglePreview,
    textPreview: controlPreview.textPreview,
    menuPreview: controlPreview.menuPreview,
    countdownPreview: controlPreview.countdownPreview,
    imageTextPreview: controlPreview.imageTextPreview,
    imagePreview: controlPreview.imagePreview,
    modelPreview: controlPreview.modelPreview,
    monsterPreview: controlPreview.monsterPreview,
    containerPreview: controlPreview.containerPreview,
    layoutPreview,
    sizePreview,
    containerElementId: binding.elementId,
    containerParentId: binding.parentId,
    containerChildIds: binding.childIds.length > 0 ? binding.childIds : undefined,
    warning,
  };
}

function parseStatementValues(
  source: string,
  start: number,
  end: number,
  token: string,
  syntax: DialogStatementSchema['syntax']
): ParsedStatementValues {
  const contentStart = start + token.length + 1;
  const contentEnd = Math.max(contentStart, end - 1);
  const delimiter = syntax === 'key-value' ? '|' : ':';
  const segments = splitTopLevel(source, contentStart, contentEnd, delimiter);
  const keyed = new Map<string, ValueSpan>();
  const keyNames = new Map<string, string>();
  if (syntax === 'key-value') {
    for (const segment of segments) {
      const raw = source.slice(segment.start, segment.end);
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
      if (!match) continue;
      const equals = raw.indexOf('=', match.index);
      const valueStart = segment.start + equals + 1;
      const normalizedKey = match[1].toLowerCase();
      keyed.set(normalizedKey, trimSpan(source, valueStart, segment.end));
      keyNames.set(normalizedKey, match[1]);
    }
  }
  return {
    positional: segments.map(segment => trimSpan(source, segment.start, segment.end)),
    keyed,
    keyNames,
  };
}

function statementContainerBinding(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): StatementContainerBinding {
  if (schema.syntax === 'key-value') {
    return {
      elementId: normalizeContainerId(cleanStaticValue(keyedValue(values, 'id'))),
      childIds: parseContainerIds(keyedValue(values, 'children')?.raw),
      shifted: false,
    };
  }

  const first = positionalValue(values, 1);
  const pair = parseContainerPair(first?.raw);
  if (!pair) return { childIds: [], shifted: false };
  const firstMeaning = normalizeContainerMeaning(schema.parameterMeanings.get(1) || '');
  const declared = firstMeaning.includes('父子容器')
    || schema.id === 'container-newline';
  return {
    ...pair,
    raw: first,
    childIds: [],
    shifted: !declared,
  };
}

function parseContainerPair(value: string | undefined): {
  parentId?: string;
  elementId?: string;
} | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/\s*(?:\/@.*|[|{].*)$/, '');
  const match = /^\s*(#[A-Za-z0-9_$.-]+)?\s*~\s*(#?[A-Za-z0-9_$.-]+)?\s*$/i.exec(cleaned);
  if (!match || (!match[1] && !match[2])) return undefined;
  return {
    parentId: normalizeContainerId(match[1]),
    elementId: normalizeContainerId(match[2]),
  };
}

function parseContainerIds(value: string | undefined): string[] {
  if (!value) return [];
  const result = new Set<string>();
  for (const match of value.matchAll(/#?[A-Za-z0-9_$.-]+/g)) {
    const id = normalizeContainerId(match[0]);
    if (id) result.add(id);
  }
  return [...result];
}

function normalizeContainerId(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^#/, '').toUpperCase();
  return normalized || undefined;
}

function normalizeContainerMeaning(value: string): string {
  return value.replace(/[()（）].*$/, '').replace(/\s+/g, '').toUpperCase();
}

function splitTopLevel(
  source: string,
  start: number,
  end: number,
  delimiter: string
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  let segmentStart = start;
  let angleDepth = 1;
  let braceDepth = 0;
  let quote = '';
  for (let cursor = start; cursor < end; cursor++) {
    const char = source[cursor];
    if (quote) {
      if (char === quote && source[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 1) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === delimiter && angleDepth === 1 && braceDepth === 0) {
      result.push({ start: segmentStart, end: cursor });
      segmentStart = cursor + 1;
    }
  }
  if (segmentStart <= end) result.push({ start: segmentStart, end });
  return result;
}

function findTopLevelPipe(value: string): number {
  let angleDepth = 0;
  let braceDepth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === '|' && angleDepth === 0 && braceDepth === 0) return index;
  }
  return -1;
}

function findTopLevelSlashDirective(value: string): {
  index: number;
  name: '@' | 'FCOLOR';
  valueStart: number;
} | undefined {
  let angleDepth = 0;
  let braceDepth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') {
      angleDepth++;
      continue;
    }
    if (char === '>' && angleDepth > 0) {
      angleDepth--;
      continue;
    }
    if (char === '{') {
      braceDepth++;
      continue;
    }
    if (char === '}' && braceDepth > 0) {
      braceDepth--;
      continue;
    }
    if (char !== '/' || angleDepth !== 0 || braceDepth !== 0) continue;
    if (value[index + 1] === '@') {
      return { index, name: '@', valueStart: index + 1 };
    }
    const color = /^\/FCOLOR\s*=\s*/i.exec(value.slice(index));
    if (color) {
      return { index, name: 'FCOLOR', valueStart: index + color[0].length };
    }
  }
  return undefined;
}

function findTopLevelCharacter(value: string, target: string): number {
  let angleDepth = 0;
  let braceDepth = 0;
  let parenthesisDepth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === '(') {
      if (target === '(' && angleDepth === 0 && braceDepth === 0 && parenthesisDepth === 0) {
        return index;
      }
      parenthesisDepth++;
    } else if (char === ')' && parenthesisDepth > 0) parenthesisDepth--;
    else if (
      char === target
      && angleDepth === 0
      && braceDepth === 0
      && parenthesisDepth === 0
    ) return index;
  }
  return -1;
}

function splitTopLevelText(value: string, delimiter: string): string[] {
  if (!value.trim()) return [];
  const result: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let braceDepth = 0;
  let parenthesisDepth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === '(') parenthesisDepth++;
    else if (char === ')' && parenthesisDepth > 0) parenthesisDepth--;
    else if (
      char === delimiter
      && angleDepth === 0
      && braceDepth === 0
      && parenthesisDepth === 0
    ) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

function findMarkupEnd(source: string, start: number, lineEnd: number): number {
  let depth = 0;
  let quote = '';
  for (let cursor = start; cursor < lineEnd; cursor++) {
    const char = source[cursor];
    if (quote) {
      if (char === quote && source[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') depth++;
    else if (char === '>' && --depth === 0) return cursor + 1;
  }
  return -1;
}

function trimSpan(source: string, start: number, end: number): ValueSpan {
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  return { start, end, raw: source.slice(start, end) };
}

function positionalValue(values: ParsedStatementValues, index?: number): ValueSpan | undefined {
  return index && index > 0 ? values.positional[index - 1] : undefined;
}

function keyedValue(values: ParsedStatementValues, key?: string): ValueSpan | undefined {
  return key ? values.keyed.get(key.toLowerCase()) : undefined;
}

function numericValue(value: ValueSpan | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?=\s*(?:$|[{}|/]))/.exec(value.raw);
  return match ? Number(match[1]) : undefined;
}

function coordinate(value: ValueSpan, sourceValue: number, displayValue: number): DialogCoordinate {
  const numeric = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(value.raw)!;
  const leading = value.raw.indexOf(numeric[1]);
  const start = value.start + leading;
  return {
    sourceValue,
    displayValue,
    span: { start, end: start + numeric[1].length, original: numeric[1] },
  };
}

function statementLayoutPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogLayoutPreview | undefined {
  if (schema.syntax === 'positional'
    && schema.engine === 'GOM'
    && /^text-/.test(schema.id)) {
    const centerX = legacyCenterCoordinate(positionalValue(values, schema.xParameter));
    const centerY = legacyCenterCoordinate(positionalValue(values, schema.yParameter));
    if (centerX || centerY) {
      const dynamicAxes = [
        centerX?.dynamic ? 'x' as const : undefined,
        centerY?.dynamic ? 'y' as const : undefined,
      ].filter((axis): axis is 'x' | 'y' => Boolean(axis));
      const invalidAxes = [
        centerX?.invalid ? 'x' as const : undefined,
        centerY?.invalid ? 'y' as const : undefined,
      ].filter((axis): axis is 'x' | 'y' => Boolean(axis));
      return {
        legacyCenterX: Boolean(centerX),
        legacyCenterY: Boolean(centerY),
        ...(centerX ? { legacyCenterOffsetX: centerX.offset } : {}),
        ...(centerY ? { legacyCenterOffsetY: centerY.offset } : {}),
        ...(dynamicAxes.length > 0 ? { legacyCenterDynamicAxes: dynamicAxes } : {}),
        ...(invalidAxes.length > 0 ? { legacyCenterInvalidAxes: invalidAxes } : {}),
        ...((dynamicAxes.length > 0 || invalidAxes.length > 0)
          ? { positionDynamic: true }
          : {}),
        ...(dynamicAxes.length > 0 ? { dynamic: true } : {}),
      };
    }
  }
  if (schema.syntax !== 'key-value' || schema.engine !== '996PC') return undefined;
  const positionSpans = [
    keyedValue(values, 'a'), keyedValue(values, 'ax'), keyedValue(values, 'ay'),
    keyedValue(values, 'percentx'),
    keyedValue(values, 'percenty') || keyedValue(values, 'pencenty'),
  ];
  const sizeSpans = [
    keyedValue(values, 'percentwidth'), keyedValue(values, 'percentheight'),
  ];
  const spans = [...positionSpans, ...sizeSpans];
  if (!spans.some(Boolean)) return undefined;
  const preview: DialogLayoutPreview = {
    anchor: numericValue(keyedValue(values, 'a')),
    anchorX: numericValue(keyedValue(values, 'ax')),
    anchorY: numericValue(keyedValue(values, 'ay')),
    percentX: numericValue(keyedValue(values, 'percentx')),
    percentY: numericValue(keyedValue(values, 'percenty'))
      ?? numericValue(keyedValue(values, 'pencenty')),
    percentWidth: numericValue(keyedValue(values, 'percentwidth')),
    percentHeight: numericValue(keyedValue(values, 'percentheight')),
    positionDynamic: positionSpans.some(
      value => value && numericValue(value) === undefined
    ) || undefined,
    sizeDynamic: sizeSpans.some(
      value => value && numericValue(value) === undefined
    ) || undefined,
    dynamic: spans.some(value => value && numericValue(value) === undefined) || undefined,
  };
  return preview;
}

function legacyCenterCoordinate(
  value: ValueSpan | undefined
): { offset: number; dynamic?: boolean; invalid?: boolean } | undefined {
  if (!value) return undefined;
  const raw = value.raw.trim().replace(/\s*(?:\/@.*|[|{].*)$/, '').trim();
  if (!raw.startsWith('*')) return undefined;
  const offsetSource = raw.slice(1).trim();
  if (!offsetSource) return { offset: 0 };
  if (/<\$/i.test(offsetSource)) return { offset: 0, dynamic: true };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(offsetSource)) {
    const offset = Number(offsetSource);
    return Number.isFinite(offset) ? { offset } : { offset: 0, invalid: true };
  }
  return { offset: 0, invalid: true };
}

function requiresStaticPositionLayout(preview: DialogLayoutPreview | undefined): boolean {
  if (!preview) return false;
  return preview.legacyCenterX === true
    || preview.legacyCenterY === true
    || preview.positionDynamic === true
    || preview.percentX !== undefined
    || preview.percentY !== undefined
    || preview.anchorX !== undefined
    || preview.anchorY !== undefined
    || (preview.anchor !== undefined && preview.anchor !== 0);
}

function statementSizePreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  widthSpan: ValueSpan | undefined,
  heightSpan: ValueSpan | undefined,
  width: number,
  height: number,
  derived: boolean,
  hasIntrinsicVisual: boolean
): DialogSizePreview {
  const percentWidth = schema.syntax === 'key-value' && schema.engine === '996PC'
    ? keyedValue(values, 'percentwidth')
    : undefined;
  const percentHeight = schema.syntax === 'key-value' && schema.engine === '996PC'
    ? keyedValue(values, 'percentheight')
    : undefined;
  return {
    width: statementSizeAxis(widthSpan, percentWidth, width, derived, hasIntrinsicVisual),
    height: statementSizeAxis(heightSpan, percentHeight, height, derived, hasIntrinsicVisual),
  };
}

function statementSizeAxis(
  explicit: ValueSpan | undefined,
  percentage: ValueSpan | undefined,
  baseValue: number,
  derived: boolean,
  hasIntrinsicVisual: boolean
): DialogSizeAxisPreview {
  if (percentage) {
    return {
      mode: numericValue(percentage) === undefined ? 'dynamic' : 'percent',
      baseValue,
    };
  }
  if (explicit) {
    return {
      mode: numericValue(explicit) === undefined ? 'dynamic' : 'explicit',
      baseValue,
    };
  }
  if (derived) return { mode: 'derived', baseValue };
  if (hasIntrinsicVisual) return { mode: 'intrinsic', baseValue };
  return { mode: 'default', baseValue };
}

function strictStaticAssetReference(
  archive: ValueSpan | undefined,
  image: ValueSpan | undefined,
  archiveMode: 'will-index' | 'archive-name'
): DialogAssetReference | undefined {
  if (!archive || !image || /<\$/i.test(archive.raw) || /<\$/i.test(image.raw)) {
    return undefined;
  }
  const imageIndex = numericValue(image);
  if (!Number.isSafeInteger(imageIndex) || imageIndex! < 0) return undefined;
  if (archiveMode === 'will-index') {
    const willIndex = numericValue(archive);
    return Number.isSafeInteger(willIndex) && willIndex! >= 0
      ? { willIndex, imageIndex }
      : undefined;
  }
  const archiveName = cleanStaticValue(archive)?.trim();
  return archiveName && /^[^\s|]+$/u.test(archiveName)
    ? { archiveName, imageIndex }
    : undefined;
}

function statementAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetReference | undefined {
  if (isLegacyProgressBarSchema(schema)) {
    return strictStaticAssetReference(
      positionalValue(values, 3),
      positionalValue(values, 4),
      'will-index'
    );
  }
  const keyedProgressImage = schema.id === 'newui-loadingbar-996pc'
    ? keyedValue(values, 'pcloadingbg')
    : schema.id === 'newui-slider-996pc'
      ? keyedValue(values, 'pcbgimg')
      : schema.id === 'newui-percentimg-996pc'
        ? keyedValue(values, 'pcimg')
        : undefined;
  if (keyedProgressImage) {
    return strictStaticAssetReference(
      keyedValue(values, 'wil'),
      keyedProgressImage,
      'archive-name'
    );
  }
  if (['newui-loadingbar-996pc', 'newui-slider-996pc', 'newui-percentimg-996pc']
    .includes(schema.id)) return undefined;
  if (schema.id === 'newui-textatlas-996pc') {
    return strictStaticAssetReference(
      keyedValue(values, 'wil'),
      keyedValue(values, 'pcimg'),
      'archive-name'
    );
  }
  if (schema.id === 'textatlas-996pc') {
    return strictStaticAssetReference(
      positionalValue(values, 1),
      positionalValue(values, 2),
      'will-index'
    );
  }
  if (schema.id === 'newui-menuitem-996pc') {
    // MenuItem resources are rebuilt from typed per-field diagnostics below.
    // Returning a fallback here would let dynamic/invalid values masquerade as defaults.
    return undefined;
  }
  if (/^image-countdown(?:-relative-compat)?$/.test(schema.id)) {
    const imageIndex = numericValue(positionalValue(values, schema.imageParameter));
    return imageIndex === undefined ? undefined : { archiveName: 'NewopUI', imageIndex };
  }
  if (/^image-number(?:-relative-compat)?$/.test(schema.id)) {
    const startOrType = numericValue(positionalValue(values, 1));
    const imageIndex = schema.engine === 'GEE'
      ? startOrType !== undefined && startOrType >= 0 && startOrType <= 9
        ? 1230 + startOrType * 10
        : undefined
      : startOrType;
    return imageIndex === undefined ? undefined : { archiveName: 'NewopUI', imageIndex };
  }
  if (schema.id === 'state-item-preview' || schema.id === 'dnitems-preview') {
    const imageIndex = numericValue(positionalValue(values, 1));
    return imageIndex === undefined ? undefined : {
      archiveName: schema.id === 'state-item-preview' ? 'StateItem' : 'DnItems',
      imageIndex,
    };
  }
  if (schema.id === 'newopui-preview') {
    const imageIndex = numericValue(positionalValue(values, 1));
    return imageIndex === undefined ? undefined : { archiveName: 'NewopUI', imageIndex };
  }
  const will = schema.syntax === 'key-value'
    ? keyedValue(values, schema.willKey)
    : positionalValue(values, schema.willParameter);
  const image = schema.syntax === 'key-value'
    ? keyedValue(values, schema.imageKey)
    : positionalValue(values, schema.imageParameter);
  const count = schema.syntax === 'key-value'
    ? keyedValue(values, schema.frameCountKey)
    : positionalValue(values, schema.frameCountParameter);
  // A temporarily resolved <$...> must never become a concrete archive or image
  // request. Source binding restores this unresolved reference after variables are
  // evaluated, so the provider cannot accidentally hydrate a guessed animation.
  if (will && /<\$/i.test(will.raw)) return undefined;
  if (image && /<\$/i.test(image.raw)) return undefined;
  const willNumber = numericValue(will);
  const imageIndex = numericValue(image);
  const archiveName = will && willNumber === undefined
    ? stripValueSuffix(will.raw)
    : undefined;
  if (willNumber === undefined && !archiveName && imageIndex === undefined) return undefined;
  const reference: DialogAssetReference = {};
  if (willNumber !== undefined) reference.willIndex = willNumber;
  if (archiveName) reference.archiveName = archiveName;
  if (imageIndex !== undefined) reference.imageIndex = imageIndex;
  const frameCount = numericValue(count);
  if (frameCount !== undefined) reference.frameCount = frameCount;
  return reference;
}

function statementAssetStateDiagnostics(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetStateDiagnostic[] | undefined {
  let archiveMode: 'will-index' | 'archive-name';
  let archive: ValueSpan | undefined;
  let states: Array<{
    role: DialogAssetStateDiagnostic['role'];
    image: ValueSpan | undefined;
  }>;
  if (/^imgex-(?:absolute|relative-996pc)$/.test(schema.id)) {
    archiveMode = 'will-index';
    archive = positionalValue(values, 1);
    states = [
      { role: 'normal', image: positionalValue(values, 2) },
      { role: 'hover', image: positionalValue(values, 3) },
      { role: 'pressed', image: positionalValue(values, 4) },
    ];
  } else if (schema.id === 'newui-button-996pc') {
    archiveMode = 'archive-name';
    archive = keyedValue(values, 'wil');
    states = [
      { role: 'normal', image: keyedValue(values, 'pcnimg') },
      { role: 'hover', image: keyedValue(values, 'pcmimg') },
      { role: 'pressed', image: keyedValue(values, 'pcpimg') },
    ];
  } else if (schema.id === 'newui-checkbox-996pc') {
    archiveMode = 'archive-name';
    archive = keyedValue(values, 'wil');
    states = [
      { role: 'normal', image: keyedValue(values, 'pcnimg') },
      { role: 'selected', image: keyedValue(values, 'pcpimg') },
    ];
  } else {
    return undefined;
  }

  let archiveStatus: DialogAssetStateDiagnostic['status'] = 'static';
  let archiveBase: Omit<DialogAssetReference, 'imageIndex'> | undefined;
  if (!archive || !archive.raw.trim()) archiveStatus = 'missing';
  else if (/<\$/i.test(archive.raw)) archiveStatus = 'dynamic';
  else if (archiveMode === 'will-index') {
    const willIndex = numericValue(archive);
    if (Number.isInteger(willIndex) && willIndex! >= 0) archiveBase = { willIndex };
    else archiveStatus = 'invalid';
  } else {
    const archiveName = cleanStaticValue(archive)?.trim();
    if (archiveName && /^[^\s|]+$/u.test(archiveName)) archiveBase = { archiveName };
    else archiveStatus = 'invalid';
  }

  return states.map(({ role, image }) => {
    if (archiveStatus !== 'static' || !archiveBase) return { role, status: archiveStatus };
    if (!image || !image.raw.trim()) return { role, status: 'missing' };
    if (/<\$/i.test(image.raw)) return { role, status: 'dynamic' };
    const imageIndex = numericValue(image);
    if (!Number.isInteger(imageIndex) || imageIndex! < 0) return { role, status: 'invalid' };
    return {
      role,
      status: 'static',
      assetRef: { ...archiveBase, imageIndex },
    };
  });
}

function statementControlPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  primaryAsset: DialogAssetReference | undefined
): StatementControlPreview {
  const parameters = statementParameters(values, schema);
  const colorWarnings = statementColorBoundaryWarnings(parameters, schema);
  const itemPreview = statementItemPreview(values, schema);
  const costItemPreview = statementCostItemPreview(values, schema);
  const progressPreview = statementProgressPreview(values, schema);
  const sliderPreview = statementSliderPreview(values, schema);
  const runtimeActionPreview = statementRuntimeActionPreview(values, schema);
  const inputPreview = statementInputPreview(values, schema);
  const togglePreview = statementTogglePreview(values, schema);
  const countdownPreview = statementCountdownPreview(values, schema);
  const textPreview = statementTextPreview(values, schema, countdownPreview);
  const imageTextPreview = statementImageTextPreview(
    values,
    schema,
    countdownPreview,
    primaryAsset
  );
  const imagePreview = statementImagePreview(values, schema);
  const modelPreview = statementModelPreview(values, schema);
  const menuPreview = statementMenuPreview(values, schema);
  const animationPreview = statementAnimationPreview(values, schema, primaryAsset);
  const containerPreview = statementContainerPreview(values, schema);
  const assetStateDiagnostics = statementAssetStateDiagnostics(values, schema);
  const assetLayers: DialogAssetLayer[] = [];

  if (itemPreview) {
    if (itemPreview.mode === 'empty-box') {
      const blockedBackground = itemPreview.backgroundDisabled === true
        || itemPreview.dynamicFields?.includes('background')
        || itemPreview.invalidFields?.includes('background');
      if (primaryAsset && !blockedBackground) {
        assetLayers.push({ role: 'background', assetRef: primaryAsset });
      }
    } else if (itemPreview.mode === 'direct-archive') {
      const frame = resolveItemFrameAssetReference(schema.engine, itemPreview.frameValue);
      if (frame) assetLayers.push({ role: 'background', assetRef: frame });
      if (primaryAsset) assetLayers.push({ role: 'item', assetRef: primaryAsset });
    } else if (/custom-item-preview/i.test(schema.id)) {
      if (primaryAsset) assetLayers.push({ role: 'background', assetRef: primaryAsset });
    } else {
      const frame = resolveItemFrameAssetReference(schema.engine, itemPreview.frameValue);
      if (frame) assetLayers.push({ role: 'background', assetRef: frame });
    }
  }

  if (progressPreview) {
    if (schema.id === 'newui-percentimg-996pc') {
      if (primaryAsset) assetLayers.push({ role: 'progress', assetRef: primaryAsset });
    } else {
      if (primaryAsset) assetLayers.push({ role: 'background', assetRef: primaryAsset });
      const fill = progressAssetReference(values, schema);
      if (fill) assetLayers.push({ role: 'progress', assetRef: fill });
      const thumb = sliderThumbAssetReference(values, schema);
      if (thumb) assetLayers.push({ role: 'thumb', assetRef: thumb });
    }
  }

  if (togglePreview) {
    const selected = assetStateDiagnostics
      ?.find(candidate => candidate.role === 'selected' && candidate.status === 'static')
      ?.assetRef
      || (!assetStateDiagnostics
        ? checkboxSelectedAssetReference(values, schema, primaryAsset)
        : undefined);
    if (selected) assetLayers.push({ role: 'selected', assetRef: selected });
  }

  if (menuPreview) {
    for (const diagnostic of menuPreview.assetDiagnostics) {
      if ((diagnostic.sourceStatus === 'default' || diagnostic.sourceStatus === 'static')
        && diagnostic.assetRef && diagnostic.role !== 'background') {
        assetLayers.push({ role: diagnostic.role, assetRef: diagnostic.assetRef });
      }
    }
  }

  if (containerPreview?.variant === 'list') {
    for (const diagnostic of containerPreview.scrollbarDiagnostics || []) {
      if (diagnostic.sourceStatus === 'static' && diagnostic.assetRef) {
        assetLayers.push({ role: diagnostic.role, assetRef: diagnostic.assetRef });
      }
    }
  }
  if (assetStateDiagnostics) {
    for (const diagnostic of assetStateDiagnostics) {
      if (
        (diagnostic.role === 'hover' || diagnostic.role === 'pressed')
        && diagnostic.status === 'static'
        && diagnostic.assetRef
      ) {
        assetLayers.push({ role: diagnostic.role, assetRef: diagnostic.assetRef });
      }
    }
  } else {
    assetLayers.push(...interactiveAssetReferences(values, schema));
  }
  const imageNumber = /^image-number(?:-relative-compat)?$/.test(schema.id);
  const imageNumberValue = imageNumber ? cleanStaticValue(positionalValue(values, 2)) : undefined;
  const unsupportedNegative = imageNumber && Boolean(imageNumberValue?.startsWith('-'));
  const imageNumberType = imageNumber ? numericValue(positionalValue(values, 1)) : undefined;
  const invalidGeeImageNumberType = imageNumber
    && schema.engine === 'GEE'
    && imageNumberType !== undefined
    && (imageNumberType < 0 || imageNumberType > 9);
  const legacyText = /^text-/.test(schema.id);
  const bigNumberText = schema.id === 'big-number-text';
  const geeLegacySimpleNumber = legacyText
    && schema.engine === 'GEE'
    && Boolean(legacyTextStyleValue(values, 'SIMPLENUM'));
  const geeLegacyStarCoordinate = legacyText
    && schema.engine === 'GEE'
    && [schema.xParameter, schema.yParameter].some(parameter => (
      positionalValue(values, parameter)?.raw.includes('*')
    ));
  const textControlName = schema.id === 'newui-rtext-996pc' ? 'RText' : 'Text';

  return {
    parameters,
    assetLayers: assetLayers.length > 0 ? assetLayers : undefined,
    assetStateDiagnostics,
    itemPreview,
    costItemPreview,
    progressPreview,
    sliderPreview,
    runtimeActionPreview,
    inputPreview,
    togglePreview,
    textPreview,
    menuPreview,
    countdownPreview,
    imageTextPreview,
    imagePreview,
    modelPreview,
    animationPreview,
    containerPreview,
    warning: [
      ...colorWarnings,
      assetStateDiagnostics?.some(diagnostic => diagnostic.status !== 'static')
        ? `状态素材 ${assetStateDiagnostics
          .filter(diagnostic => diagnostic.status !== 'static')
          .map(diagnostic => `${diagnostic.role}=${diagnostic.status}`)
          .join('、')}；动态值不借用 MOV 当前值，无效或缺失状态不会请求猜测素材`
        : undefined,
      togglePreview?.dynamicFields?.length
        ? `${togglePreview.dynamicFields.includes('checked') ? 'CheckBox 默认状态是动态值；' : ''}CheckBox 的 ${togglePreview.dynamicFields.join('、')} 包含动态值，静态预览不借用变量当前值，也不模拟服务器提交`
        : undefined,
      togglePreview?.invalidFields?.length
        ? `CheckBox 的 ${togglePreview.invalidFields.join('、')} 参数无效；默认状态仅支持 0/1，静态预览保持未知`
        : undefined,
      menuDefaultPreviewWarning(menuPreview),
      menuPreview
        ? `MenuItem ${menuPreview.menuId || '未绑定变量'} 的选择仅本地预览，不提交服务器`
        : undefined,
      menuPreview?.link
        ? `MenuItem 点击标签 ${menuPreview.link} 仅展示，Ctrl+F12 不执行服务器脚本`
        : undefined,
      menuPreview?.dynamicFields?.length
        ? `MenuItem 的 ${menuPreview.dynamicFields.join('、')} 包含动态值，静态预览使用可确定内容和安全回退，不把变量默认值冒充运行时结果`
        : undefined,
      menuPreview?.invalidFields?.length
        ? `MenuItem 的 ${menuPreview.invalidFields.join('、')} 参数无效，静态预览使用安全回退`
        : undefined,
      itemPreview?.mode === 'empty-box'
        ? 'Runtime-data blocked：ITEMBOX 可静态绘制框体和 StdMode 约束，但实际拖入物品、人物背包数据以及服务器接受/拒绝结果无法离线模拟'
        : undefined,
      /^(?:hero-)?custom-item-preview$/.test(schema.id)
        ? 'Runtime-data blocked：CustomItem 可静态绘制脚本指定框底图并保留内观开关，但真实人物或英雄装备内容依赖在线运行时数据'
        : undefined,
      itemPreview?.mode === 'empty-box' && itemPreview.dynamicFields?.length
        ? `ITEMBOX 的 ${itemPreview.dynamicFields.join('、')} 包含动态值，静态预览不借用 MOV 当前值，未知背景不会进入素材解析`
        : undefined,
      itemPreview?.mode === 'empty-box' && itemPreview.invalidFields?.length
        ? `ITEMBOX 的 ${itemPreview.invalidFields.join('、')} 参数无效；框编号和 StdMode 必须是非负整数，* 不能与列表混用，未知背景不会进入素材解析`
        : undefined,
      itemPreview?.dynamicFields?.length
        ? `ItemShow 的 ${itemPreview.dynamicFields.join('、')} 包含动态值，静态预览仅绘制可确定部分，不把变量默认值冒充运行时结果`
        : undefined,
      itemPreview?.invalidFields?.length
        ? `物品控件的 ${itemPreview.invalidFields.join('、')} 参数无效；开关仅支持 0 或 1，scale 必须为正数，effectshow 仅支持 0-2，静态预览使用安全回退`
        : undefined,
      itemPreview?.locked
        ? '996PC ItemShow 手册未公开锁图标素材编号，Ctrl+F12 使用 CSS 锁形静态近似'
        : undefined,
      itemPreview?.lightCode
        ? `发光代码 ${itemPreview.lightCode} 已保留，但手册未公开精确混合算法，Ctrl+F12 不伪造客户端发光`
        : undefined,
      itemPreview?.drawEffect
        ? '物品特效开关已保留；实际特效需要数据库字段、特效列表和素材映射，当前不猜测图层'
        : undefined,
      itemPreview?.effectShow
        ? `装备特效模式 ${itemPreview.effectShow} 已保留；装备内容和特效资源属于运行时数据，当前不伪造图层`
        : undefined,
      itemPreview?.showStar
        ? '星级开关已保留；具体星级取决于运行时唯一物品数据，当前显示“☆?”边界标记'
        : undefined,
      itemPreview?.showTips && ['equipment', 'hero-equipment', 'unique-item'].includes(itemPreview.mode)
        ? '物品属性提示已启用，但完整属性取决于运行时装备或唯一物品数据，Ctrl+F12 仅保留提示边界'
        : undefined,
      costItemPreview?.titleUsesClientDefault
        ? 'CostItem 未配置 title，客户端会使用默认标题，但手册未公开默认文字'
        : undefined,
      costItemPreview?.dynamic
        ? 'CostItem 包含动态标题、数量、字号或缩放值，静态预览仅显示可确定内容'
        : undefined,
      progressPreview?.dynamicFields?.length
        ? `进度条的 ${progressPreview.dynamicFields.join('、')} 包含动态值，静态预览仅绘制可确定部分，不借用 MOV 当前值，也不猜测运行时进度`
        : undefined,
      progressPreview?.invalidFields?.length
        ? `进度条的 ${progressPreview.invalidFields.join('、')} 参数无效；方向仅允许 0-3（LoadingBar 仅 0-1），颜色仅允许 0-255 或显式十六进制，非法范围和素材不会绘制`
        : undefined,
      sliderPreview?.dynamicFields?.length
        ? `Slider 的 ${sliderPreview.dynamicFields.join('、')} 包含动态值，确定性交互已禁用，不借用变量当前值`
        : undefined,
      sliderPreview?.invalidFields?.length
        ? `Slider 的 ${sliderPreview.invalidFields.join('、')} 参数无效；最大值必须大于 0，默认值必须位于范围内`
        : undefined,
      runtimeActionPreview
        ? '该控件的点击、双击、输入提交或刷新动作仅本地预览，不提交服务器，也不执行 @ 标签或刷新真实客户端'
        : undefined,
      runtimeActionPreview?.delayUnit === 'manual-unspecified'
        ? 'CheckBox delay 的时间单位在当前手册中未公开，Ctrl+F12 只展示原值，不启动自动服务器动作'
        : undefined,
      runtimeActionPreview?.dynamicFields?.length
        ? `运行时动作的 ${runtimeActionPreview.dynamicFields.join('、')} 包含动态值，静态预览不借用 MOV 当前值，相关本地动作已禁用`
        : undefined,
      runtimeActionPreview?.invalidFields?.length
        ? `运行时动作的 ${runtimeActionPreview.invalidFields.join('、')} 参数无效，相关本地动作已禁用`
        : undefined,
      textPreview?.dynamicFields?.length
        ? '文字包含动态内容或样式：可确定值直接显示，未确定文字显示“预览文字”，未确定数量显示 0；动态样式、数值简化和滚动参数使用安全预览边界'
        : undefined,
      bigNumberText
        ? 'BigNum 当前为 Partial simulation：手册未公开最低显示单位、单位阈值和单位配置，静态预览保留安全源值，不伪造客户端单位转换'
        : undefined,
      bigNumberText && textPreview?.dynamicFields?.includes('text')
        ? 'BigNum 数值在当前静态路径无法确定，画布显示 0；原始表达式仅保留在 Inspector 和源码定位中'
        : undefined,
      textPreview?.simplifyNumberApproximate
        ? 'SIMPLENUM 的万/亿单位有手册证据，但非整倍数的小数精度未公开，当前使用两位小数静态近似'
        : undefined,
      textPreview?.fontFamily
        ? 'FNAME 按源码字体名交给 Chromium；若本机未安装，浏览器回退外观不代表客户端字体'
        : undefined,
      geeLegacySimpleNumber || geeLegacyStarCoordinate
        ? `GEE 当前手册未证明传统 Text ${[
          geeLegacySimpleNumber ? 'SIMPLENUM' : '',
          geeLegacyStarCoordinate ? '*' : '',
        ].filter(Boolean).join(' / ')} 语义，未套用 GOM 规则`
        : undefined,
      textPreview?.invalidFields?.length
        ? `${textControlName} 的 ${textPreview.invalidFields.join('、')} 参数无效；静态预览已忽略这些值，滚动宽高和时间必须大于 0，方向只支持 0 或 1`
        : undefined,
      containerPreview?.variant === 'list' && containerPreview.dynamic
        ? 'ListView 包含动态或无效的方向、间隔、默认索引、cantouch 或 bounce，静态预览使用可确定的安全回退'
        : undefined,
      containerPreview?.variant === 'list'
        && containerPreview.bounce !== undefined
        && Number(containerPreview.bounce) !== 0
        ? 'ListView bounce 参数已保留，但官方未公开阻尼和回弹曲线；Ctrl+F12 严格限制在内容边界，不伪造客户端动画'
        : undefined,
      ...itemGridBoundaryWarnings(containerPreview),
      containerPreview?.scrollbarMode === 'client-default'
        ? '996PC ListView 已启用客户端默认滑块，但手册未公开默认素材，静态预览不猜测具体外观'
        : undefined,
      containerPreview?.scrollbarDynamic
        ? 'ListView 滚动条素材包含动态或无效值，对应素材不绘制'
        : undefined,
      countdownPreview?.dynamic
        ? `倒计时的 ${(countdownPreview.dynamicFields || []).join('、')} 包含动态值，静态预览显示未知且不启动计时器`
        : undefined,
      countdownPreview?.invalidFields?.length
        ? `倒计时的 ${countdownPreview.invalidFields.join('、')} 参数无效，静态预览显示未知且不执行结束标签`
        : undefined,
      animationPreview?.dynamicFields?.length
        ? `动画的 ${animationPreview.dynamicFields.join('、')} 包含动态值，静态预览使用安全首帧且不借用变量当前值`
        : undefined,
      animationPreview?.invalidFields?.length
        ? `动画的 ${animationPreview.invalidFields.join('、')} 参数无效，静态预览使用安全首帧`
        : undefined,
      ...animationBoundaryWarnings(animationPreview),
      unsupportedNegative
        ? 'IMGNUM 所属引擎不支持负数，负号已使用明确占位预览'
        : undefined,
      invalidGeeImageNumberType
        ? 'GEE IMGNUM 数字类型仅支持 0-9，当前使用占位预览'
        : undefined,
      inputPreview?.showBackground
        ? '996PC Input 默认背景框没有公开素材编号，当前使用 CSS 静态近似'
        : undefined,
      inputPreview?.dynamicFields?.length
        ? `输入框的 ${inputPreviewFieldLabels(inputPreview.dynamicFields)} 包含动态值，静态预览保持未知，不借用 MOV 当前值`
        : undefined,
      inputPreview?.invalidFields?.length
        ? `输入框的 ${inputPreviewFieldLabels(inputPreview.invalidFields)} 参数无效，静态预览不截断、不钳制也不猜测`
        : undefined,
      imageTextPreview
        && imageTextPreview.glyphs.some(glyph => !glyph.assetRef)
        && !unsupportedNegative
        && !invalidGeeImageNumberType
        ? '图片数字素材序号无法静态确定或字符没有对应素材，部分字符使用占位预览'
        : undefined,
      imageTextPreview?.textAtlasVariant && imageTextPreview.dynamicFields?.length
        ? `TextAtlas 的 ${imageTextPreview.dynamicFields.join('、')} 包含动态值；静态预览不借用 MOV 当前值，也不按表达式源码长度伪造数字几何`
        : undefined,
      imageTextPreview?.textAtlasVariant && imageTextPreview.invalidFields?.length
        ? `TextAtlas 的 ${imageTextPreview.invalidFields.join('、')} 参数无效；素材序号必须是非负整数，字形宽高必须是正整数，显示内容只接受 0-9`
        : undefined,
      imageTextPreview?.textAtlasVariant === 'legacy-individual'
        ? '传统 996PC TextAtlas 使用连续 0-9 单图；X/Y 精细偏移的客户端流式布局规则未完整公开，Ctrl+F12 保留相对静态近似'
        : undefined,
      imagePreview?.variant.startsWith('gom-') && imagePreview.dynamicFields?.length
        ? `GOM 图片的 ${imagePreview.dynamicFields.join('、')} 包含动态值；静态预览不借用 MOV 当前值伪造标题、提交参数或点击标签`
        : undefined,
      imagePreview?.variant.startsWith('gom-') && imagePreview.invalidFields?.includes('title')
        ? 'GOM 图片标题未形成有效的“标题,X,Y,颜色#”结构；按手册作为旧输入框检查兼容参数保留，不伪造可见标题'
        : undefined,
      imagePreview?.variant === 'newui-img-996pc'
        ? '996PC Img 的客户端窗口字段在 Ctrl+F12 中仅本地预览和展示，不执行 ESC 关闭、界面移动/重置、延迟加载、隐藏主 UI、背包装备限制、真实 reload 或窗口层控制'
        : undefined,
      imagePreview?.variant === 'newui-img-996pc' && imagePreview.defaultFields?.length
        ? `Img 的 ${imagePreview.defaultFields.join('、')} 未填写，已明确标记为默认字段；只有手册公开的 opacity=255 与 grey=0 使用已证明默认值`
        : undefined,
      imagePreview?.variant === 'newui-img-996pc' && imagePreview.dynamicFields?.length
        ? `Img 的 ${imagePreview.dynamicFields.join('、')} 包含动态/运行时值，静态预览不借用 MOV 当前值，也不执行客户端动作`
        : undefined,
      imagePreview?.variant === 'newui-img-996pc' && imagePreview.invalidFields?.length
        ? `Img 参数无效：opacity 必须在 0-255；开关字段只能使用 0 / 1；show 必须在 0-4；layerid 必须是非负整数；scale9 边距必须为非负数。无效值不会钳制或强制转换成有效绘制`
        : undefined,
      imagePreview?.directPathPreview?.status === 'evidence-blocked'
        ? `Evidence-blocked：已识别 Img 直接路径 ${imagePreview.directPathPreview.normalized}，但 public/ 的可信根目录和客户端加载规则未公开，Ctrl+F12 不发起文件或网络加载`
        : undefined,
      imagePreview?.directPathPreview?.status === 'blocked'
        ? `Direct-path blocked：Img 直接路径 ${imagePreview.directPathPreview.raw} 含路径穿越、绝对路径或不可信协议，已在 provider 之前拒绝`
        : undefined,
      imagePreview?.directPathPreview?.status === 'invalid'
        ? `Direct-path invalid：Img 直接路径 ${imagePreview.directPathPreview.raw || '(空)'} 无法安全静态确定，未进入 provider`
        : undefined,
      imagePreview?.submitIds
        ? `IMGEX 输入框提交参数 ${imagePreview.submitIds} 已保留；Ctrl+F12 不执行客户端提交`
        : undefined,
      imagePreview?.link
        ? `图片点击标签 ${imagePreview.link} 已保留；Ctrl+F12 不执行服务器脚本`
        : undefined,
      modelPreview
        ? 'UIModel 静态预览仅绘制可确定的 StateItem 部件；裸模和头发未绘制'
        : undefined,
      modelPreview?.dynamicFields?.length
        ? `UIModel 的 ${modelPreview.dynamicFields.join('、')} 包含动态值；静态预览不借用变量当前值，也不请求不确定素材`
        : undefined,
      modelPreview?.invalidFields?.length
        ? `UIModel 的 ${modelPreview.invalidFields.join('、')} 参数无效；静态预览保留安全边界，不猜测素材或状态`
        : undefined,
      modelPreview && [
        'clotheffectid', 'weaponeffectid', 'headeffectid',
        'capeffectid', 'shieldeffectid', 'veileffectid',
      ].some(key => Boolean(cleanStaticValue(keyedValue(values, key))))
        ? 'UIModel 内观特效映射尚无可靠素材证据，特效未绘制'
        : undefined,
    ].filter(Boolean).join('；') || undefined,
  };
}

function statementImagePreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogImagePreview | undefined {
  const command = statementCommand(schema);
  if (schema.engine === 'GOM' && (command === 'IMG' || command === 'IMGEX')) {
    const titleSpan = positionalValue(values, command === 'IMG' ? 5 : 8);
    if (!titleSpan) return undefined;
    const rawTitle = stripValueSuffix(titleSpan.raw).trim();
    if (!rawTitle) return undefined;
    const dynamicFields: NonNullable<DialogImagePreview['dynamicFields']> = [];
    const invalidFields: NonNullable<DialogImagePreview['invalidFields']> = [];
    let title: DialogImagePreview['title'];
    if (/<\$/i.test(rawTitle)) {
      dynamicFields.push('title');
    } else {
      title = parseGomImageTitle(rawTitle);
      if (!title) invalidFields.push('title');
    }

    const submitSpan = command === 'IMGEX' ? positionalValue(values, 7) : undefined;
    let submitIds: string | undefined;
    if (submitSpan && /<\$/i.test(stripValueSuffix(submitSpan.raw))) {
      dynamicFields.push('submit');
    } else {
      submitIds = cleanStaticValue(submitSpan);
    }
    const linkDynamic = statementLinkIsDynamic(values, schema);
    if (linkDynamic) dynamicFields.push('link');
    const link = linkDynamic ? undefined : statementEventLink(values, schema);

    return {
      variant: command === 'IMG' ? 'gom-img' : 'gom-imgex',
      opacity: 255,
      gray: false,
      ...(title ? { title } : {}),
      ...(submitIds ? { submitIds } : {}),
      ...(link ? { link } : {}),
      ...(dynamicFields.length > 0 ? { dynamic: true, dynamicFields } : {}),
      ...(invalidFields.length > 0 ? { invalidFields } : {}),
    };
  }
  if (schema.id !== 'newui-img-996pc') return undefined;
  const defaultFields: NonNullable<DialogImagePreview['defaultFields']> = [];
  const dynamicFields: NonNullable<DialogImagePreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogImagePreview['invalidFields']> = [];
  const pushUnique = (
    fields: NonNullable<DialogImagePreview['defaultFields']>,
    field: NonNullable<DialogImagePreview['defaultFields']>[number]
  ): void => {
    if (!fields.includes(field)) fields.push(field);
  };
  const imageRuntimeNumber = (
    spanValue: ValueSpan | undefined,
    field: NonNullable<DialogImagePreview['defaultFields']>[number],
    valid: (value: number) => boolean,
    missingValue?: number
  ): number | undefined => {
    if (!spanValue) {
      pushUnique(defaultFields, field);
      return missingValue;
    }
    if (/<\$/i.test(spanValue.raw)) {
      pushUnique(dynamicFields, field);
      return undefined;
    }
    const parsed = numericValue(spanValue);
    if (parsed === undefined || !valid(parsed)) {
      pushUnique(invalidFields, field);
      return undefined;
    }
    return parsed;
  };
  const imageRuntimeBinary = (
    key: string,
    field: NonNullable<DialogImagePreview['defaultFields']>[number],
    missingValue?: boolean
  ): boolean | undefined => {
    const parsed = imageRuntimeNumber(
      keyedValue(values, key), field, value => value === 0 || value === 1,
      missingValue === undefined ? undefined : missingValue ? 1 : 0
    );
    return parsed === undefined ? undefined : parsed === 1;
  };

  const opacityValue = imageRuntimeNumber(
    keyedValue(values, 'opacity'), 'opacity',
    value => Number.isInteger(value) && value >= 0 && value <= 255,
    255
  );
  const gray = imageRuntimeBinary('grey', 'gray', false);
  const background = imageRuntimeBinary('bg', 'background');
  const escapeClose = imageRuntimeBinary('esc', 'escape-close');
  const movable = imageRuntimeBinary('move', 'move');
  const resetPosition = imageRuntimeBinary('reset', 'reset');
  const loadDelay = imageRuntimeBinary('loaddelay', 'load-delay');
  const hideMain = imageRuntimeBinary('hidemain', 'hide-main');
  const forbidBagEquip = imageRuntimeBinary('forbidbagequip', 'forbid-bag-equip');
  const bagPosition = imageRuntimeNumber(
    keyedValue(values, 'bagpos'), 'bag-position', value => value === 0 || value === 1
  ) as 0 | 1 | undefined;
  const reload = imageRuntimeBinary('reload', 'reload');
  const showValue = imageRuntimeNumber(
    keyedValue(values, 'show'), 'show-position',
    value => Number.isInteger(value) && value >= 0 && value <= 4
  ) as 0 | 1 | 2 | 3 | 4 | undefined;
  const layerId = imageRuntimeNumber(
    keyedValue(values, 'layerid'), 'layer-id',
    value => Number.isInteger(value) && value >= 0
  );
  const scaleSpans = {
    left: keyedValue(values, 'scale9l'),
    right: keyedValue(values, 'scale9r'),
    top: keyedValue(values, 'scale9t'),
    bottom: keyedValue(values, 'scale9b'),
  };
  const scaleFieldNames = {
    left: 'scale9-left',
    right: 'scale9-right',
    top: 'scale9-top',
    bottom: 'scale9-bottom',
  } as const;
  const scaleValues: Partial<Record<keyof typeof scaleSpans, number>> = {};
  for (const key of Object.keys(scaleSpans) as Array<keyof typeof scaleSpans>) {
    scaleValues[key] = imageRuntimeNumber(
      scaleSpans[key], scaleFieldNames[key], value => Number.isFinite(value) && value >= 0, 0
    );
  }
  const scaleFields = Object.values(scaleFieldNames);
  const scaleBlocked = scaleFields.some(field => (
    dynamicFields.includes(field) || invalidFields.includes(field)
  ));
  const scale9 = !scaleBlocked && Object.values(scaleValues).some(value => Number(value) > 0)
    ? {
      left: scaleValues.left ?? 0,
      right: scaleValues.right ?? 0,
      top: scaleValues.top ?? 0,
      bottom: scaleValues.bottom ?? 0,
    }
    : undefined;
  const directPathPreview = imageDirectPathPreview(keyedValue(values, 'img'));
  return {
    variant: 'newui-img-996pc',
    ...(opacityValue !== undefined ? { opacity: opacityValue } : {}),
    ...(gray !== undefined ? { gray } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(escapeClose !== undefined ? { escapeClose } : {}),
    ...(movable !== undefined ? { movable } : {}),
    ...(resetPosition !== undefined ? { resetPosition } : {}),
    ...(loadDelay !== undefined ? { loadDelay } : {}),
    ...(hideMain !== undefined ? { hideMain } : {}),
    ...(forbidBagEquip !== undefined ? { forbidBagEquip } : {}),
    ...(bagPosition !== undefined ? { bagPosition } : {}),
    ...(reload !== undefined ? { reload } : {}),
    ...(showValue !== undefined ? { showPosition: showValue } : {}),
    ...(layerId !== undefined ? { layerId } : {}),
    ...(scale9 ? { scale9 } : {}),
    ...(directPathPreview ? { directPathPreview } : {}),
    localOnly: true,
    runtimeScope: 'local-only',
    ...(defaultFields.length > 0 ? { defaultFields } : {}),
    ...(dynamicFields.length > 0 ? { dynamic: true, dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function imageDirectPathPreview(
  value: ValueSpan | undefined
): DialogImagePreview['directPathPreview'] | undefined {
  if (!value) return undefined;
  const raw = value.raw.trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return { raw, status: 'invalid' };
  if (/<\$/i.test(raw)) return { raw, status: 'invalid' };
  const slashNormalized = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const segments = slashNormalized.split('/');
  const traversal = segments.some(segment => segment === '..' || segment === '.')
    || /^[A-Za-z]:/.test(slashNormalized)
    || slashNormalized.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(slashNormalized)
    || /[\0\r\n]/.test(slashNormalized);
  if (traversal) return { raw, status: 'blocked' };
  return {
    raw,
    normalized: slashNormalized,
    status: 'evidence-blocked',
  };
}

function parseGomImageTitle(
  value: string
): NonNullable<DialogImagePreview['title']> | undefined {
  if (!value.endsWith('#')) return undefined;
  const match = /^(.*),([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([^,]+)#$/.exec(value);
  if (!match) return undefined;
  const text = match[1].trim();
  const offsetX = Number(match[2]);
  const offsetY = Number(match[3]);
  const colorValue = match[4].trim();
  const color = tooltipColor(colorValue);
  if (!text || !Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !color) return undefined;
  return { raw: value, text, offsetX, offsetY, colorValue, color };
}

function statementInputPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogInputPreview | undefined {
  const dynamicFields: NonNullable<DialogInputPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogInputPreview['invalidFields']> = [];
  const sourceIsDynamic = (span: ValueSpan | undefined): boolean => (
    Boolean(span && /<\$/i.test(span.raw))
  );
  const addDynamic = (
    span: ValueSpan | undefined,
    field: NonNullable<DialogInputPreview['dynamicFields']>[number]
  ): boolean => {
    if (!sourceIsDynamic(span)) return false;
    dynamicFields.push(field);
    return true;
  };
  const staticNumber = (
    span: ValueSpan | undefined,
    field: NonNullable<DialogInputPreview['invalidFields']>[number],
    valid: (value: number) => boolean
  ): number | undefined => {
    if (!span || addDynamic(span, field)) return undefined;
    const value = numericValue(span);
    if (value === undefined || !valid(value)) {
      invalidFields.push(field);
      return undefined;
    }
    return value;
  };
  const staticText = (
    span: ValueSpan | undefined,
    field: NonNullable<DialogInputPreview['dynamicFields']>[number]
  ): string | undefined => {
    if (!span || addDynamic(span, field)) return undefined;
    return cleanStaticValue(span);
  };
  const staticColor = (
    span: ValueSpan | undefined,
    field: NonNullable<DialogInputPreview['invalidFields']>[number]
  ): string | undefined => {
    const index = staticNumber(
      span,
      field,
      value => Number.isInteger(value) && value >= 0 && value <= 255
    );
    return index === undefined ? undefined : statementValueColor(span);
  };
  const applyBoundPair = (
    preview: DialogInputPreview,
    minimum: number | undefined,
    maximum: number | undefined,
    minimumField: 'min-length' | 'min-value',
    maximumField: 'max-length' | 'max-value',
    zeroMeansUnbounded: boolean
  ): void => {
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      invalidFields.push(minimumField, maximumField);
      return;
    }
    if (minimum !== undefined && (!zeroMeansUnbounded || minimum !== 0)) {
      if (minimumField === 'min-length') preview.minLength = minimum;
      else preview.minValue = minimum;
    }
    if (maximum !== undefined && (!zeroMeansUnbounded || maximum !== 0)) {
      if (maximumField === 'max-length') preview.maxLength = maximum;
      else preview.maxValue = maximum;
    }
  };
  const finish = (preview: DialogInputPreview): DialogInputPreview => {
    const uniqueDynamic = [...new Set(dynamicFields)];
    const uniqueInvalid = [...new Set(invalidFields)];
    if (uniqueDynamic.length > 0) {
      preview.dynamic = true;
      preview.dynamicFields = uniqueDynamic;
    }
    if (uniqueInvalid.length > 0) preview.invalidFields = uniqueInvalid;
    return preview;
  };

  if (schema.id === 'newui-input-996pc') {
    const typeSpan = keyedValue(values, 'type');
    const modes: Record<number, DialogInputPreview['mode']> = {
      0: 'text',
      1: 'number',
      2: 'password',
      3: 'absolute-number',
    };
    let typeValue = 0;
    if (typeSpan) {
      const parsedType = staticNumber(
        typeSpan,
        'mode',
        value => Number.isInteger(value) && Boolean(modes[value])
      );
      if (parsedType !== undefined) typeValue = parsedType;
    }
    const preview: DialogInputPreview = {
      mode: modes[typeValue] || 'text',
    };
    const inputId = staticNumber(
      keyedValue(values, 'inputid'),
      'input-id',
      value => Number.isInteger(value) && value >= 1 && value <= 9
    );
    const placeholder = staticText(keyedValue(values, 'place'), 'placeholder');
    const placeholderColor = staticColor(
      keyedValue(values, 'placecolor'),
      'placeholder-color'
    );
    const textColor = staticColor(keyedValue(values, 'color'), 'text-color');
    const fontSize = staticNumber(
      keyedValue(values, 'size'),
      'font-size',
      value => Number.isFinite(value) && value > 0
    );
    const minLength = staticNumber(
      keyedValue(values, 'mincount'),
      'min-length',
      value => Number.isInteger(value) && value >= 0
    );
    const maxLength = staticNumber(
      keyedValue(values, 'maxcount'),
      'max-length',
      value => Number.isInteger(value) && value >= 0
    );
    const errorTips = staticText(keyedValue(values, 'errortips'), 'error-tips');
    const onlyChineseSpan = keyedValue(values, 'onlych');
    const showBackgroundSpan = keyedValue(values, 'bgtype');
    const onlyChinese = onlyChineseSpan
      ? staticNumber(
        onlyChineseSpan,
        'only-chinese',
        value => Number.isInteger(value) && (value === 0 || value === 1)
      )
      : 0;
    const showBackground = showBackgroundSpan
      ? staticNumber(
        showBackgroundSpan,
        'show-background',
        value => Number.isInteger(value) && (value === 0 || value === 1)
      )
      : 0;

    if (inputId !== undefined) preview.inputId = inputId;
    if (placeholder !== undefined) preview.placeholder = placeholder;
    if (placeholderColor !== undefined) preview.placeholderColor = placeholderColor;
    if (textColor !== undefined) preview.textColor = textColor;
    if (fontSize !== undefined) preview.fontSize = fontSize;
    applyBoundPair(
      preview,
      minLength,
      maxLength,
      'min-length',
      'max-length',
      false
    );
    if (errorTips !== undefined) preview.errorTips = errorTips;
    if (onlyChinese !== undefined) preview.onlyChinese = onlyChinese === 1;
    if (showBackground !== undefined) preview.showBackground = showBackground === 1;
    return finish(preview);
  }

  const textInput = /^input-text(?:-relative-compat)?$/.test(schema.id);
  const numberInput = /^input-number(?:-relative-compat)?$/.test(schema.id);
  const memoInput = /^input-memo(?:-relative-compat)?$/.test(schema.id);
  if (!textInput && !numberInput && !memoInput) return undefined;

  const preview: DialogInputPreview = {
    mode: numberInput ? 'number' : memoInput ? 'memo' : 'text',
  };
  const inputId = staticNumber(
    positionalValue(values, 1),
    'input-id',
    value => Number.isInteger(value)
      && value >= 1
      && value <= (schema.engine === '996PC' ? 9 : 40)
  );
  const background = positionalValue(values, 6);
  const border = positionalValue(values, 7);
  const backgroundIndex = staticNumber(
    background,
    'background-color',
    value => Number.isInteger(value) && value >= -1 && value <= 255
  );
  const borderIndex = staticNumber(
    border,
    'border-color',
    value => Number.isInteger(value) && value >= -1 && value <= 255
  );
  const placeholder = memoInput
    ? undefined
    : staticText(positionalValue(values, 12), 'placeholder');
  const placeholderColor = memoInput
    ? undefined
    : staticColor(positionalValue(values, 13), 'placeholder-color');
  const textColor = staticColor(positionalValue(values, 8), 'text-color');
  const backgroundColor = backgroundIndex === undefined || backgroundIndex === -1
    ? undefined
    : statementValueColor(background);
  const borderColor = borderIndex === undefined || borderIndex === -1
    ? undefined
    : statementValueColor(border);
  const minimum = staticNumber(
    positionalValue(values, 9),
    numberInput ? 'min-value' : 'min-length',
    value => numberInput ? Number.isFinite(value) : Number.isInteger(value) && value >= 0
  );
  const maximum = staticNumber(
    positionalValue(values, 10),
    numberInput ? 'max-value' : 'max-length',
    value => numberInput ? Number.isFinite(value) : Number.isInteger(value) && value >= 0
  );
  const errorTips = staticText(
    positionalValue(values, memoInput ? 13 : 11),
    'error-tips'
  );
  const lineHeight = memoInput
    ? staticNumber(
      positionalValue(values, 11),
      'line-height',
      value => Number.isFinite(value) && value >= 0
    )
    : undefined;
  const autoWrap = memoInput
    ? staticNumber(
      positionalValue(values, 12),
      'auto-wrap',
      value => Number.isInteger(value) && (value === 0 || value === 1)
    )
    : undefined;

    if (inputId !== undefined) preview.inputId = inputId;
  if (backgroundIndex !== undefined) preview.transparentBackground = backgroundIndex === -1;
  if (borderIndex !== undefined) preview.borderless = borderIndex === -1;
  if (placeholder !== undefined) preview.placeholder = placeholder;
  if (placeholderColor !== undefined) preview.placeholderColor = placeholderColor;
  if (textColor !== undefined) preview.textColor = textColor;
  if (backgroundColor !== undefined) preview.backgroundColor = backgroundColor;
  if (borderColor !== undefined) preview.borderColor = borderColor;
  applyBoundPair(
    preview,
    minimum,
    maximum,
    numberInput ? 'min-value' : 'min-length',
    numberInput ? 'max-value' : 'max-length',
    !numberInput
  );
  if (lineHeight !== undefined && lineHeight !== 0) preview.lineHeight = lineHeight;
  if (autoWrap !== undefined) preview.autoWrap = autoWrap === 1;
  if (errorTips !== undefined) preview.errorTips = errorTips;

  if (numberInput && minimum === 0 && maximum === 0) {
    delete preview.minValue;
    delete preview.maxValue;
  }
  return finish(preview);
}

const INPUT_PREVIEW_FIELD_LABELS: Record<
  NonNullable<DialogInputPreview['dynamicFields']>[number],
  string
> = {
  mode: '输入类型',
  'input-id': '输入框 ID',
  placeholder: '提示文字',
  'placeholder-color': '提示文字颜色',
  'text-color': '文字颜色',
  'background-color': '背景色',
  'border-color': '边框色',
  'font-size': '字号',
  'min-length': '最小长度',
  'max-length': '最大长度',
  'min-value': '最小值',
  'max-value': '最大值',
  'line-height': '行高',
  'auto-wrap': '自动换行',
  'only-chinese': '仅中文',
  'show-background': '背景框开关',
  'error-tips': '错误提示',
};

function inputPreviewFieldLabels(
  fields: NonNullable<DialogInputPreview['dynamicFields']> | undefined
): string {
  return (fields || []).map(field => INPUT_PREVIEW_FIELD_LABELS[field]).join('、');
}

function statementMonsterControl(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): StatementMonsterControl | undefined {
  if (schema.id !== 'monster-preview') return undefined;

  if (schema.engine === 'GEE') {
    const raceImg = numericValue(positionalValue(values, 1));
    const appr = numericValue(positionalValue(values, 2));
    const displayMode = numericValue(positionalValue(values, 3));
    const direction = numericValue(positionalValue(values, 4));
    const fields = {
      ...(raceImg !== undefined ? { raceImg } : {}),
      ...(appr !== undefined ? { appr } : {}),
      ...(displayMode !== undefined ? { displayMode } : {}),
      ...(direction !== undefined ? { direction } : {}),
    };

    if (raceImg === 156) {
      const message = 'RaceImg=156 需要 SmartMonster\\怪物名.ini，但 MONSTER 标签不含怪物名';
      return {
        preview: {
          variant: 'gee',
          status: 'smart-monster-unresolved',
          ...fields,
          message,
        },
        warning: `${message}，无法静态定位素材；这不是补丁缓存缺失`,
      };
    }

    if (appr === undefined || raceImg === undefined) {
      const message = 'APPR 或 RaceImg 是动态值，无法静态确定怪物素材';
      return {
        preview: { variant: 'gee', status: 'dynamic', ...fields, message },
        warning: message,
      };
    }

    const representative = resolveMonsterRepresentativeAsset(appr);
    if (!representative) {
      const message = `APPR ${String(appr)} 不是有效的非负整数`;
      return {
        preview: { variant: 'gee', status: 'invalid', ...fields, message },
        warning: message,
      };
    }

    const message = `${representative.archiveName} / ${String(
      representative.imageIndex
    ).padStart(6, '0')} 静态代表帧`;
    const rangeWarnings = [
      displayMode !== undefined && ![0, 1, 10, 11].includes(displayMode)
        ? `显示方式 ${displayMode} 超出文档范围 0/1/10/11`
        : undefined,
      direction !== undefined && (!Number.isInteger(direction) || direction < 0 || direction > 7)
        ? `方向 ${direction} 超出文档范围 0-7`
        : undefined,
    ].filter(Boolean);
    return {
      preview: {
        variant: 'gee',
        status: 'static-representative',
        ...fields,
        message,
      },
      assetRef: {
        archiveName: representative.archiveName,
        imageIndex: representative.imageIndex,
      },
      warning: [
        'GEE/LFM MONSTER 当前使用已验证的静态代表帧；显示方式与方向的完整帧步长没有可靠文档，参数已保留但未逐状态还原',
        ...rangeWarnings,
      ].join('；'),
    };
  }

  if (schema.engine !== 'GOM') return undefined;

  const appr = numericValue(positionalValue(values, 1));
  const race = numericValue(positionalValue(values, 2));
  const action = numericValue(positionalValue(values, 3));
  const direction = numericValue(positionalValue(values, 4));
  const fields = {
    ...(appr !== undefined ? { appr } : {}),
    ...(race !== undefined ? { race } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(direction !== undefined ? { direction } : {}),
  };

  if (race === 156) {
    const message = 'Race=156 需要 SmartMonster\\怪物名.ini，但 MONSTER 标签不含怪物名';
    return {
      preview: {
        variant: 'gom',
        status: 'smart-monster-unresolved',
        ...fields,
        message,
      },
      warning: `${message}，无法静态定位素材；这不是补丁缓存缺失`,
    };
  }

  if (appr === undefined || race === undefined) {
    const message = 'APPR 或 RACE 是动态值，无法静态确定怪物素材';
    return {
      preview: { variant: 'gom', status: 'dynamic', ...fields, message },
      warning: message,
    };
  }

  const representative = resolveMonsterRepresentativeAsset(appr);
  if (!representative) {
    const message = `APPR ${String(appr)} 不是有效的非负整数`;
    return {
      preview: { variant: 'gom', status: 'invalid', ...fields, message },
      warning: message,
    };
  }

  const message = `${representative.archiveName} / ${String(
    representative.imageIndex
  ).padStart(6, '0')} 静态代表帧`;
  const rangeWarnings = [
    action !== undefined && (!Number.isInteger(action) || action < 0 || action > 6)
      ? `动作 ${action} 超出文档范围 0-6`
      : undefined,
    direction !== undefined && (!Number.isInteger(direction) || direction < 0 || direction > 7)
      ? `方向 ${direction} 超出文档范围 0-7`
      : undefined,
  ].filter(Boolean);
  return {
    preview: {
      variant: 'gom',
      status: 'static-representative',
      ...fields,
      message,
    },
    assetRef: {
      archiveName: representative.archiveName,
      imageIndex: representative.imageIndex,
    },
    warning: [
      'GOM MONSTER 当前使用已验证的静态代表帧；动作与方向的完整帧步长没有可靠文档，参数已保留但未逐动作还原',
      ...rangeWarnings,
    ].join('；'),
  };
}

function statementRuntimeActionPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogRuntimeActionPreview | undefined {
  const completionControl = /^(?:(?:image-)?countdown(?:-relative-compat)?|time-tips|newui-(?:countdown|timetips|loadingbar)-996pc)$/i.test(schema.id);
  const sliderControl = schema.id === 'newui-slider-996pc';
  if (completionControl || sliderControl) {
    const linkSpan = schema.syntax === 'key-value' ? keyedValue(values, 'link') : undefined;
    const dynamic = statementLinkIsDynamic(values, schema)
      || Boolean(linkSpan && /<\$/i.test(linkSpan.raw));
    const link = statementEventLink(values, schema);
    if (!link && !dynamic && !linkSpan) return undefined;
    const preview: DialogRuntimeActionPreview = {
      trigger: sliderControl ? 'change' : 'completion',
      localOnly: true,
    };
    if (link) preview.link = link;
    if (dynamic) preview.dynamicFields = ['link'];
    else if (linkSpan && !link) preview.invalidFields = ['link'];
    return preview;
  }
  const legacy = legacyStatementClickActionPreview(values, schema);
  if (schema.syntax === 'positional' && statementCommand(schema) === 'IMGNUM') {
    return imageNumberSubmitActionPreview(values, legacy);
  }
  if (legacy) return legacy;
  if (schema.engine !== '996PC' || schema.syntax !== 'key-value') return undefined;

  const submitSpan = keyedValue(values, 'submitinput');
  const linkSpan = keyedValue(values, 'link');
  const doubleClickSpan = keyedValue(values, 'dblink');
  const reloadSpan = keyedValue(values, 'reload');
  const checkboxAction = schema.id === 'newui-checkbox-996pc';
  const delaySpan = checkboxAction ? keyedValue(values, 'delay') : undefined;
  const countSpan = checkboxAction ? keyedValue(values, 'count') : undefined;
  if (!submitSpan && !linkSpan && !doubleClickSpan && !reloadSpan && !delaySpan && !countSpan) {
    return undefined;
  }

  const preview: DialogRuntimeActionPreview = { localOnly: true };
  const dynamicFields: NonNullable<DialogRuntimeActionPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogRuntimeActionPreview['invalidFields']> = [];

  if (submitSpan) {
    const ids: number[] = [];
    let dynamic = false;
    let invalid = false;
    for (const part of submitSpan.raw.split(',')) {
      const value = part.trim();
      if (/<\$/i.test(value)) {
        dynamic = true;
        continue;
      }
      if (!/^\d+$/.test(value)) {
        invalid = true;
        continue;
      }
      const id = Number(value);
      if (!Number.isInteger(id) || id < 1 || id > 9) {
        invalid = true;
        continue;
      }
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > 0) preview.submitInputIds = ids;
    if (dynamic) dynamicFields.push('submit-inputs');
    if (invalid || (ids.length === 0 && !dynamic)) invalidFields.push('submit-inputs');
  }

  const assignLink = (
    spanValue: ValueSpan | undefined,
    field: 'link' | 'double-click-link'
  ): void => {
    if (!spanValue) return;
    if (/<\$/i.test(spanValue.raw)) {
      dynamicFields.push(field);
      return;
    }
    const value = stripValueSuffix(spanValue.raw).trim();
    if (!value) {
      invalidFields.push(field);
      return;
    }
    const link = value.startsWith('@') ? value : `@${value}`;
    if (field === 'link') preview.link = link;
    else preview.doubleClickLink = link;
  };
  assignLink(linkSpan, 'link');
  assignLink(doubleClickSpan, 'double-click-link');

  if (reloadSpan) {
    const reload = numericValue(reloadSpan);
    if (/<\$/i.test(reloadSpan.raw)) dynamicFields.push('reload');
    else if (reload === 0 || reload === 1) preview.reload = reload === 1;
    else invalidFields.push('reload');
  }

  if (delaySpan) {
    const delay = numericValue(delaySpan);
    if (/<\$/i.test(delaySpan.raw)) dynamicFields.push('delay');
    else if (delay !== undefined && Number.isFinite(delay) && delay >= 0) {
      preview.delay = delay;
      preview.delayUnit = 'manual-unspecified';
    } else invalidFields.push('delay');
  }
  if (countSpan) {
    const count = numericValue(countSpan);
    if (/<\$/i.test(countSpan.raw)) dynamicFields.push('count');
    else if (count !== undefined && Number.isInteger(count) && count >= 0) preview.count = count;
    else invalidFields.push('count');
  }

  if (dynamicFields.length > 0) preview.dynamicFields = [...new Set(dynamicFields)];
  if (invalidFields.length > 0) preview.invalidFields = [...new Set(invalidFields)];
  return preview;
}

function imageNumberSubmitActionPreview(
  values: ParsedStatementValues,
  legacy: DialogRuntimeActionPreview | undefined
): DialogRuntimeActionPreview | undefined {
  const submitSpan = positionalValue(values, 6);
  if (!submitSpan) return legacy;

  const pipe = findTopLevelPipe(submitSpan.raw);
  const submitSource = (pipe >= 0 ? submitSpan.raw.slice(0, pipe) : submitSpan.raw).trim();
  if (submitSource === '0' || submitSource === '*') return legacy;

  const preview: DialogRuntimeActionPreview = legacy ? {
    ...legacy,
    ...(legacy.submitInputIds ? { submitInputIds: [...legacy.submitInputIds] } : {}),
    ...(legacy.dynamicFields ? { dynamicFields: [...legacy.dynamicFields] } : {}),
    ...(legacy.invalidFields ? { invalidFields: [...legacy.invalidFields] } : {}),
  } : {
    trigger: 'click',
    localOnly: true,
  };
  const ids: number[] = [];
  let dynamic = false;
  let invalid = false;
  for (const part of splitTopLevelText(submitSource, ',')) {
    const value = part.trim();
    if (/<\$/i.test(value)) {
      dynamic = true;
      continue;
    }
    if (!/^[1-9]$/.test(value)) {
      invalid = true;
      continue;
    }
    const id = Number(value);
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > 0) preview.submitInputIds = ids;
  if (dynamic) preview.dynamicFields = [...new Set([
    ...(preview.dynamicFields || []),
    'submit-inputs' as const,
  ])];
  if (invalid || (ids.length === 0 && !dynamic)) preview.invalidFields = [...new Set([
    ...(preview.invalidFields || []),
    'submit-inputs' as const,
  ])];
  return preview;
}

function legacyStatementClickActionPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogRuntimeActionPreview | undefined {
  if (schema.syntax !== 'positional') return undefined;
  const command = statementCommand(schema);
  if (![
    'TEXT', 'IMG', 'IMGEX', 'IMGNUM', 'ITEMSHOW', 'USERITEM', 'HEROUSERITEM',
    'MAKEINDEXITEM', 'STATEITEM', 'DNITEMS',
  ].includes(command)) return undefined;
  for (const value of values.positional) {
    const directive = findTopLevelSlashDirective(value.raw);
    if (!directive || directive.name !== '@') continue;
    return parseLegacyClickAction(value.raw.slice(directive.index + 1)).preview;
  }
  return undefined;
}

function statementTogglePreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogTogglePreview | undefined {
  if (schema.id !== 'newui-checkbox-996pc') return undefined;
  const initial = keyedValue(values, 'default');
  const value = numericValue(initial);
  const dynamicFields: NonNullable<DialogTogglePreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogTogglePreview['invalidFields']> = [];
  let checked: boolean | undefined;
  if (!initial) checked = false;
  else if (/<\$/i.test(initial.raw) || value === undefined) dynamicFields.push('checked');
  else if (value === 0 || value === 1) checked = value === 1;
  else invalidFields.push('checked');

  const variableSpan = keyedValue(values, 'checkboxid');
  const submitSpan = keyedValue(values, 'submit');
  const delaySpan = keyedValue(values, 'delay');
  const countSpan = keyedValue(values, 'count');
  const linkSpan = keyedValue(values, 'link');
  const variableName = cleanStaticValue(variableSpan);
  const submitMode = cleanStaticValue(submitSpan);
  const delay = numericValue(delaySpan);
  const count = numericValue(countSpan);
  const link = cleanStaticValue(linkSpan);
  if (variableSpan && !variableName) dynamicFields.push('variable');
  if (submitSpan && !submitMode) dynamicFields.push('submit');
  if (delaySpan) {
    if (/<\$/i.test(delaySpan.raw)) dynamicFields.push('delay');
    else if (!Number.isFinite(delay) || delay! < 0) invalidFields.push('delay');
  }
  if (countSpan) {
    if (/<\$/i.test(countSpan.raw)) dynamicFields.push('count');
    else if (!Number.isInteger(count) || count! < 0) invalidFields.push('count');
  }
  if (linkSpan && !link) dynamicFields.push('link');
  return {
    ...(checked !== undefined ? { checked, initialChecked: checked } : {}),
    ...(variableName ? { variableName } : {}),
    ...(submitMode ? { submitMode } : {}),
    ...(delay !== undefined && !invalidFields.includes('delay') && !dynamicFields.includes('delay')
      ? { delayMs: delay }
      : {}),
    ...(count !== undefined && !invalidFields.includes('count') && !dynamicFields.includes('count')
      ? { repeatCount: count }
      : {}),
    ...(link ? { link } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function statementSliderPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogSliderPreview | undefined {
  if (schema.id !== 'newui-slider-996pc') return undefined;
  const maximumSpan = keyedValue(values, 'maxvalue');
  const valueSpan = keyedValue(values, 'defvalue');
  const variableSpan = keyedValue(values, 'sliderid');
  const linkSpan = keyedValue(values, 'link');
  const archiveSpan = keyedValue(values, 'wil');
  const backgroundSpan = keyedValue(values, 'pcbgimg');
  const progressSpan = keyedValue(values, 'pcbarimg');
  const thumbSpan = keyedValue(values, 'pcballimg');
  const defaultFields: NonNullable<DialogSliderPreview['defaultFields']> = [];
  const dynamicFields: NonNullable<DialogSliderPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogSliderPreview['invalidFields']> = [];
  const add = <T extends string>(target: T[], field: T): void => {
    if (!target.includes(field)) target.push(field);
  };
  const strictNumber = (
    spanValue: ValueSpan | undefined,
    field: NonNullable<DialogSliderPreview['dynamicFields']>[number],
    valid: (candidate: number) => boolean,
    fallback?: number
  ): number | undefined => {
    if (!spanValue) {
      if (fallback !== undefined && (field === 'maximum' || field === 'value')) {
        add(defaultFields, field);
      } else if (fallback === undefined) add(invalidFields, field);
      return fallback;
    }
    if (/<\$/i.test(spanValue.raw)) {
      add(dynamicFields, field);
      return undefined;
    }
    const parsed = numericValue(spanValue);
    if (parsed === undefined || !valid(parsed)) {
      add(invalidFields, field);
      return undefined;
    }
    return parsed;
  };
  const strictResource = (
    spanValue: ValueSpan | undefined,
    field: 'background-image' | 'progress-image' | 'thumb-image'
  ): void => {
    strictNumber(spanValue, field, candidate => Number.isInteger(candidate) && candidate >= 0);
  };

  let archiveName: string | undefined;
  if (!archiveSpan) add(invalidFields, 'archive');
  else if (/<\$/i.test(archiveSpan.raw)) add(dynamicFields, 'archive');
  else {
    archiveName = cleanStaticValue(archiveSpan);
    if (!archiveName) add(invalidFields, 'archive');
  }
  strictResource(backgroundSpan, 'background-image');
  strictResource(progressSpan, 'progress-image');
  strictResource(thumbSpan, 'thumb-image');

  const maximum = strictNumber(maximumSpan, 'maximum', candidate => candidate > 0, 100);
  let initialValue = strictNumber(
    valueSpan,
    'value',
    candidate => candidate >= 0,
    0
  );
  if (
    initialValue !== undefined
    && maximum !== undefined
    && initialValue > maximum
  ) {
    add(invalidFields, 'value');
    initialValue = undefined;
  }

  let variableName: string | undefined;
  if (!variableSpan) add(invalidFields, 'variable');
  else if (/<\$/i.test(variableSpan.raw)) add(dynamicFields, 'variable');
  else {
    const candidate = cleanStaticValue(variableSpan);
    if (candidate && /^(?:N(?:0|[1-9][0-9]{0,2})|N\$[A-Za-z_\u3400-\u9fff][\w$\u3400-\u9fff]*)$/iu.test(candidate)) {
      variableName = candidate;
    } else add(invalidFields, 'variable');
  }

  let link: string | undefined;
  if (linkSpan) {
    if (/<\$/i.test(linkSpan.raw)) add(dynamicFields, 'link');
    else {
      const candidate = cleanStaticValue(linkSpan);
      if (!candidate) add(invalidFields, 'link');
      else link = candidate.startsWith('@') ? candidate : `@${candidate}`;
    }
  }

  return {
    minimum: 0,
    ...(maximum !== undefined && !dynamicFields.includes('maximum')
      && !invalidFields.includes('maximum') ? { maximum } : {}),
    ...(initialValue !== undefined && !dynamicFields.includes('value')
      && !invalidFields.includes('value') ? { initialValue } : {}),
    ...(variableName ? { variableName } : {}),
    ...(link ? { link } : {}),
    ...(defaultFields.length > 0 ? { defaultFields } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function checkboxSelectedAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  primaryAsset: DialogAssetReference | undefined
): DialogAssetReference | undefined {
  if (schema.id !== 'newui-checkbox-996pc') return undefined;
  const imageIndex = numericValue(keyedValue(values, 'pcpimg'));
  if (imageIndex === undefined) return undefined;
  if (primaryAsset) return { ...primaryAsset, imageIndex };
  const archiveName = cleanStaticValue(keyedValue(values, 'wil'));
  return archiveName ? { archiveName, imageIndex } : undefined;
}

function statementTextPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  countdownPreview: DialogCountdownPreview | undefined
): DialogTextPreview | undefined {
  if (/^image-countdown(?:-relative-compat)?$/.test(schema.id)) return undefined;
  const richText = schema.id === 'newui-rtext-996pc';
  const plainText = schema.id === 'newui-text-996pc';
  const scrollingText = richText || plainText;
  const multilineText = schema.id === 'container-mtext';
  const legacyText = /^text-/.test(schema.id);
  const bigNumberText = schema.id === 'big-number-text';
  const legacyStyledText = legacyText || bigNumberText;
  if (!richText && !plainText && !multilineText && !legacyText
    && !bigNumberText && schema.id !== 'newui-button-996pc' && !countdownPreview) {
    return undefined;
  }
  const rawText = multilineText
    ? positionalValue(values, schema.textParameter)
    : legacyStyledText
      ? positionalValue(values, schema.textParameter)
      : keyedValue(values, 'text');
  if ((richText || plainText || multilineText || legacyStyledText
    || schema.id === 'newui-button-996pc') && !rawText) {
    return undefined;
  }
  const sourceText = countdownPreview?.initialText
    || cleanDisplayText(rawText!.raw, multilineText);
  const keyed = schema.syntax === 'key-value';
  const fontSizeSpan = keyed
    ? keyedValue(values, 'size')
    : legacyStyledText ? legacyTextStyleValue(values, 'FSIZE') : undefined;
  const fontFamilySpan = legacyStyledText ? legacyTextStyleValue(values, 'FNAME') : undefined;
  const fontBoldSpan = legacyText ? legacyTextStyleValue(values, 'FBOLD') : undefined;
  const outlineWidthSpan = keyed ? keyedValue(values, 'outline') : undefined;
  const outlineColorSpan = keyed ? keyedValue(values, 'outlinecolor') : undefined;
  const colorSpan = legacyStyledText
    ? undefined
    : keyed
      ? keyedValue(values, 'color')
      : positionalValue(values, multilineText ? 4 : 3);
  const simplifySpan = plainText
    ? keyedValue(values, 'simplenum')
    : legacyText && schema.engine === 'GOM'
      ? legacyTextStyleValue(values, 'SIMPLENUM')
      : undefined;
  const scrollWidthSpan = scrollingText ? keyedValue(values, 'scrollwidth') : undefined;
  const scrollHeightSpan = scrollingText ? keyedValue(values, 'scrollheight') : undefined;
  const scrollDirectionSpan = scrollingText ? keyedValue(values, 'scrollway') : undefined;
  const scrollDurationSpan = scrollingText ? keyedValue(values, 'scrolltime') : undefined;
  const parsedFontSize = numericValue(fontSizeSpan);
  const fontSize = parsedFontSize !== undefined
    && Number.isFinite(parsedFontSize) && parsedFontSize > 0
    ? parsedFontSize : undefined;
  const fontFamily = cleanStaticValue(fontFamilySpan);
  const parsedFontBold = numericValue(fontBoldSpan);
  const bold = parsedFontBold === 0 || parsedFontBold === 1
    ? parsedFontBold === 1 : undefined;
  const parsedOutlineWidth = keyed ? numericValue(outlineWidthSpan) : undefined;
  const outlineWidth = parsedOutlineWidth !== undefined
    && Number.isFinite(parsedOutlineWidth) && parsedOutlineWidth >= 0
    ? parsedOutlineWidth : undefined;
  const graySpan = schema.id === 'newui-button-996pc'
    ? keyedValue(values, 'grey') : undefined;
  const parsedGray = numericValue(graySpan);
  const gray = parsedGray === 0 || parsedGray === 1
    ? parsedGray === 1 : undefined;
  const colorValues = plainText ? statementColorValues(colorSpan) : undefined;
  const colorFrames = plainText ? statementValueColors(colorSpan) : undefined;
  const legacyStyle = legacyStyledText ? legacyTextColorStyle(values) : undefined;
  const color = colorFrames?.[0] || statementValueColor(colorSpan)
    || (legacyStyle && legacyStyle.mode !== 'AUTOCOLOR'
      ? parseDialogColor(legacyStyle.value) : undefined);
  const outlineColor = keyed ? statementValueColor(outlineColorSpan) : undefined;
  const simplifyValue = numericValue(simplifySpan);
  const simplifyNumber = simplifyValue === 1;
  const text = simplifyNumber ? simplifyDialogTextNumber(sourceText) : sourceText;
  const simplifyNumberApproximate = simplifyNumber
    && dialogTextNumberSimplificationIsApproximate(sourceText);
  const parsedScrollWidth = numericValue(scrollWidthSpan);
  const parsedScrollHeight = numericValue(scrollHeightSpan);
  const parsedScrollDirection = numericValue(scrollDirectionSpan);
  const parsedScrollDuration = numericValue(scrollDurationSpan);
  const scrollWidth = parsedScrollWidth !== undefined
    && Number.isFinite(parsedScrollWidth) && parsedScrollWidth > 0
    ? parsedScrollWidth : undefined;
  const scrollHeight = parsedScrollHeight !== undefined
    && Number.isFinite(parsedScrollHeight) && parsedScrollHeight > 0
    ? parsedScrollHeight : undefined;
  const scrollDirection = parsedScrollDirection === 0 || parsedScrollDirection === 1
    ? parsedScrollDirection : undefined;
  const parsedScrollDurationMs = parsedScrollDuration === undefined
    ? undefined : parsedScrollDuration * 1000;
  const scrollDurationMs = parsedScrollDuration !== undefined
    && parsedScrollDuration > 0
    && Number.isFinite(parsedScrollDurationMs)
    ? parsedScrollDurationMs : undefined;
  const dynamicFields: NonNullable<DialogTextPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogTextPreview['invalidFields']> = [];
  const addDynamicField = (field: NonNullable<DialogTextPreview['dynamicFields']>[number]) => {
    if (!dynamicFields.includes(field)) dynamicFields.push(field);
  };
  const addInvalidField = (field: NonNullable<DialogTextPreview['invalidFields']>[number]) => {
    if (!invalidFields.includes(field)) invalidFields.push(field);
  };
  if (plainText || richText || multilineText || schema.id === 'newui-button-996pc') {
    for (const [span, parsed, field, valid] of [
      [simplifySpan, simplifyValue, 'simplify-number',
        (value: number) => value === 0 || value === 1],
      [fontSizeSpan, parsedFontSize, 'font-size',
        (value: number) => Number.isFinite(value) && value > 0],
      [outlineWidthSpan, parsedOutlineWidth, 'outline-width',
        (value: number) => Number.isFinite(value) && value >= 0],
      [graySpan, parsedGray, 'gray',
        (value: number) => value === 0 || value === 1],
      [scrollWidthSpan, parsedScrollWidth, 'scroll-width',
        (value: number) => Number.isFinite(value) && value > 0],
      [scrollHeightSpan, parsedScrollHeight, 'scroll-height',
        (value: number) => Number.isFinite(value) && value > 0],
      [scrollDirectionSpan, parsedScrollDirection, 'scroll-direction',
        (value: number) => value === 0 || value === 1],
      [scrollDurationSpan, parsedScrollDuration, 'scroll-duration',
        (value: number) => value > 0 && Number.isFinite(value * 1000)],
    ] as Array<[
      ValueSpan | undefined,
      number | undefined,
      NonNullable<DialogTextPreview['invalidFields']>[number],
      (value: number) => boolean
    ]>) {
      if (!span) continue;
      if (/<\$/i.test(span.raw)) addDynamicField(field);
      else if (parsed === undefined || !valid(parsed)) addInvalidField(field);
    }
    if (rawText && /<\$/i.test(rawText.raw)) addDynamicField('text');
    if (colorSpan) {
      if (/<\$/i.test(colorSpan.raw)) addDynamicField('color');
      else if (!statementValueColor(colorSpan)) addInvalidField('color');
    }
    if (outlineColorSpan) {
      if (/<\$/i.test(outlineColorSpan.raw)) addDynamicField('outline-color');
      else if (!statementValueColor(outlineColorSpan)) addInvalidField('outline-color');
    }
  }
  if (legacyStyledText) {
    if (rawText && !cleanStaticValue(rawText)) dynamicFields.push('text');
    for (const [styleSpan, parsed, field, valid] of [
      [fontSizeSpan, parsedFontSize, 'font-size',
        (value: number) => Number.isFinite(value) && value > 0],
      [fontBoldSpan, parsedFontBold, 'font-bold',
        (value: number) => value === 0 || value === 1],
      [simplifySpan, simplifyValue, 'simplify-number',
        (value: number) => value === 0 || value === 1],
    ] as Array<[
      ValueSpan | undefined,
      number | undefined,
      NonNullable<DialogTextPreview['invalidFields']>[number],
      (value: number) => boolean
    ]>) {
      if (!styleSpan) continue;
      if (/<\$/i.test(styleSpan.raw)) {
        dynamicFields.push(field);
      } else if (parsed === undefined || !valid(parsed)) {
        invalidFields.push(field);
      }
    }
    if (fontFamilySpan) {
      if (/<\$/i.test(fontFamilySpan.raw)) dynamicFields.push('font-family');
      else if (!fontFamily) invalidFields.push('font-family');
    }
    const legacyColorSpan = legacyTextColorValue(values);
    if (legacyColorSpan && /<\$/i.test(legacyColorSpan.raw)) dynamicFields.push('color');
  }
  const visibleText = bigNumberText && dynamicFields.includes('text')
    ? `运行时：${text}`
    : text;
  const lines = visibleText.split(/\r?\n/).map(line => (
    richText || legacyStyledText ? tooltipLineRuns(line, color) : [{ text: line }]
  ));
  if (legacyStyledText && legacyStyle && !lines.some(line => (
    line.some(run => run.color || run.colorFrames?.length)
  ))) {
    for (const line of lines) {
      for (const run of line) {
        Object.assign(run, dialogTextRun(run.text, legacyStyle.value, legacyStyle.mode));
      }
    }
  }
  return {
    lines,
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(bold !== undefined ? { bold } : {}),
    ...(color ? { color } : {}),
    ...(outlineWidth !== undefined ? { outlineWidth } : {}),
    ...(outlineColor ? { outlineColor } : {}),
    align: schema.id === 'newui-button-996pc'
      || (legacyText && schema.engine === 'GOM'
        && Boolean(legacyCenterCoordinate(positionalValue(values, schema.xParameter))))
      ? 'center' : 'left',
    ...(gray !== undefined ? { gray } : {}),
    ...((plainText || (legacyText && schema.engine === 'GOM')) && simplifyNumber
      ? {
        simplifyNumber: true,
        ...(simplifyNumberApproximate ? { simplifyNumberApproximate: true } : {}),
      }
      : {}),
    ...(plainText && colorValues && colorFrames && colorFrames.length > 1
      ? { colorValues, colorFrames, colorIntervalMs: 1000 }
      : {}),
    ...(scrollingText && scrollWidth !== undefined ? { scrollWidth } : {}),
    ...(scrollingText && scrollHeight !== undefined ? { scrollHeight } : {}),
    ...(scrollingText && scrollDirection !== undefined ? { scrollDirection } : {}),
    ...(scrollingText && scrollDurationMs !== undefined ? { scrollDurationMs } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function simplifyDialogTextNumber(text: string): string {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text.trim())) return text;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  const absolute = Math.abs(value);
  const divisor = absolute >= 100_000_000 ? 100_000_000 : absolute >= 10_000 ? 10_000 : 0;
  if (!divisor) return text;
  const unit = divisor === 100_000_000 ? '亿' : '万';
  const scaled = value / divisor;
  if (Number.isInteger(scaled)) return `${scaled}${unit}`;
  // The manual documents only the 万/亿 units, not fractional precision.
  // This is an explicitly approximate preview for non-integral unit values.
  return `${scaled.toFixed(2).replace(/\.0+$|(?<=\.[0-9])0+$/g, '')}${unit}`;
}

function dialogTextNumberSimplificationIsApproximate(text: string): boolean {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text.trim())) return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  const absolute = Math.abs(value);
  const divisor = absolute >= 100_000_000 ? 100_000_000 : absolute >= 10_000 ? 10_000 : 0;
  return divisor > 0 && !Number.isInteger(value / divisor);
}

function statementCountdownPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogCountdownPreview | undefined {
  const id = schema.id.toLowerCase();
  if (!/^(?:(?:image-)?countdown(?:-relative-compat)?|time-tips|newui-(?:countdown|timetips)-996pc)$/.test(id)) {
    return undefined;
  }
  const keyed = schema.syntax === 'key-value';
  const secondsSpan = keyed ? keyedValue(values, 'time') : positionalValue(values, 1);
  const repeatSpan = keyed ? keyedValue(values, 'count') : positionalValue(values, 2);
  const rawSeconds = numericValue(secondsSpan);
  const secondsValid = Number.isInteger(rawSeconds) && rawSeconds! >= 0;
  const seconds = secondsValid ? rawSeconds : undefined;
  const rawRepeat = numericValue(repeatSpan);
  const repeatValid = Number.isInteger(rawRepeat) && rawRepeat! >= 0;
  const repeatCount = repeatValid ? rawRepeat : undefined;
  const dynamicFields: NonNullable<DialogCountdownPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogCountdownPreview['invalidFields']> = [];
  if (secondsSpan) {
    if (/<\$/i.test(secondsSpan.raw) || rawSeconds === undefined) dynamicFields.push('seconds');
    else if (!secondsValid) invalidFields.push('seconds');
  }
  if (repeatSpan) {
    if (/<\$/i.test(repeatSpan.raw) || rawRepeat === undefined) dynamicFields.push('repeat');
    else if (!repeatValid) invalidFields.push('repeat');
  }
  let format: DialogCountdownPreview['format'];
  if (id === 'time-tips' || id === 'newui-timetips-996pc') {
    format = 'pc-dhms';
  } else if (id === 'newui-countdown-996pc') {
    const formatSpan = keyedValue(values, 'showway');
    const formatValue = numericValue(formatSpan);
    if (formatSpan && (/<\$/i.test(formatSpan.raw) || formatValue === undefined)) dynamicFields.push('format');
    else if (formatSpan && formatValue !== 0 && formatValue !== 1) invalidFields.push('format');
    format = formatValue === 1 ? 'pc-smart' : 'pc-seconds';
  } else if (schema.engine === '996PC') {
    format = 'pc-seconds';
  } else {
    const modeSpan = positionalValue(values, id.startsWith('image-countdown') ? 7 : 6);
    const mode = numericValue(modeSpan);
    if (modeSpan && (/<\$/i.test(modeSpan.raw) || mode === undefined)) dynamicFields.push('format');
    else if (modeSpan && ![0, 1, 2].includes(mode!)) invalidFields.push('format');
    format = mode === 1 ? 'legacy-compact' : mode === 2 ? 'seconds' : 'legacy-fixed';
  }
  const link = statementEventLink(values, schema);
  if (statementLinkIsDynamic(values, schema)) dynamicFields.push('link');
  return {
    ...(seconds !== undefined ? { seconds } : {}),
    ...(repeatCount !== undefined ? { repeatCount } : {}),
    format,
    dynamic: dynamicFields.length > 0,
    initialText: seconds === undefined ? '?' : formatCountdownText(seconds, format),
    ...(link ? { link } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function formatCountdownText(
  value: number,
  format: DialogCountdownPreview['format']
): string {
  const seconds = Math.max(0, Math.floor(value));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const totalHours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = seconds % 60;
  const pad = (part: number): string => String(part).padStart(2, '0');
  switch (format) {
    case 'legacy-fixed':
      return `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    case 'legacy-compact':
      if (totalHours > 0) return `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
      if (minutes > 0) return `${pad(minutes)}:${pad(remainingSeconds)}`;
      return String(remainingSeconds);
    case 'seconds':
      return String(seconds);
    case 'pc-smart':
      return days > 0
        ? `${days}天${pad(hours)}时${pad(minutes)}分`
        : `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    case 'pc-dhms':
      return `${days}天${hours}时${minutes}分${remainingSeconds}秒`;
    case 'pc-seconds':
    default:
      return `${seconds}秒`;
  }
}

function statementImageTextPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  countdownPreview: DialogCountdownPreview | undefined,
  primaryAsset: DialogAssetReference | undefined
): DialogImageTextPreview | undefined {
  if (/^image-countdown(?:-relative-compat)?$/.test(schema.id)) {
    if (!countdownPreview) return undefined;
    const start = numericValue(positionalValue(values, 3));
    const gap = numericValue(positionalValue(values, 4)) ?? 0;
    const value = countdownPreview.initialText;
    const glyphFor = (character: string): DialogImageGlyph => {
      const digit = /^\d$/.test(character) ? Number(character) : undefined;
      const offset = digit ?? (character === ':' ? 10 : undefined);
      return {
        character,
        ...(start !== undefined && offset !== undefined
          ? { assetRef: { archiveName: 'NewopUI', imageIndex: start + offset } }
          : {}),
      };
    };
    return {
      mode: 'individual',
      value,
      gap,
      glyphs: [...value].map(glyphFor),
      glyphBank: [...'0123456789:'].map(glyphFor),
    };
  }

  if (/^image-number(?:-relative-compat)?$/.test(schema.id)) {
    const valueSpan = positionalValue(values, 2);
    const staticValue = cleanStaticValue(valueSpan);
    const value = staticValue ?? (displayParameterValue(valueSpan?.raw || '') || '?');
    const gap = numericValue(positionalValue(values, 3)) ?? 0;
    const startOrType = numericValue(positionalValue(values, 1));
    const start = schema.engine === 'GEE'
      ? startOrType !== undefined && startOrType >= 0 && startOrType <= 9
        ? 1230 + startOrType * 10
        : undefined
      : startOrType;
    return {
      mode: 'individual',
      value,
      gap,
      glyphs: [...value].map(character => {
        const digit = /^\d$/.test(character) ? Number(character) : undefined;
        return {
          character,
          ...(staticValue !== undefined && start !== undefined && digit !== undefined
            ? { assetRef: { archiveName: 'NewopUI', imageIndex: start + digit } }
            : {}),
        };
      }),
    };
  }

  if (!['textatlas-996pc', 'newui-textatlas-996pc'].includes(schema.id)) return undefined;
  const traditional = schema.id === 'textatlas-996pc';
  const archiveSpan = traditional ? positionalValue(values, 1) : keyedValue(values, 'wil');
  const imageSpan = traditional ? positionalValue(values, 2) : keyedValue(values, 'pcimg');
  const valueSpan = traditional ? positionalValue(values, 5) : keyedValue(values, 'text');
  const dynamicFields: DialogImageTextField[] = [];
  const invalidFields: DialogImageTextField[] = [];
  const push = (fields: DialogImageTextField[], field: DialogImageTextField): void => {
    if (!fields.includes(field)) fields.push(field);
  };
  const isDynamic = (value: ValueSpan | undefined): boolean => Boolean(value && /<\$/i.test(value.raw));

  let archiveValid = false;
  if (!archiveSpan || !archiveSpan.raw.trim()) push(invalidFields, 'archive');
  else if (isDynamic(archiveSpan)) push(dynamicFields, 'archive');
  else if (traditional) {
    const archive = numericValue(archiveSpan);
    if (Number.isSafeInteger(archive) && archive! >= 0) archiveValid = true;
    else push(invalidFields, 'archive');
  } else {
    const archive = cleanStaticValue(archiveSpan)?.trim();
    if (archive && /^[^\s|]+$/u.test(archive)) archiveValid = true;
    else push(invalidFields, 'archive');
  }

  let imageValid = false;
  if (!imageSpan || !imageSpan.raw.trim()) push(invalidFields, 'image');
  else if (isDynamic(imageSpan)) push(dynamicFields, 'image');
  else {
    const image = numericValue(imageSpan);
    if (Number.isSafeInteger(image) && image! >= 0 && image! <= Number.MAX_SAFE_INTEGER - 9) {
      imageValid = true;
    } else push(invalidFields, 'image');
  }

  let staticValue: string | undefined;
  if (!valueSpan || !valueSpan.raw.trim()) push(invalidFields, 'text');
  else if (isDynamic(valueSpan)) push(dynamicFields, 'text');
  else {
    const candidate = cleanStaticValue(valueSpan);
    if (candidate && /^\d+$/u.test(candidate)) staticValue = candidate;
    else push(invalidFields, 'text');
  }

  const baseAssetRef = archiveValid && imageValid && primaryAsset
    ? { ...primaryAsset }
    : undefined;
  if (traditional) {
    const glyphs = staticValue && baseAssetRef
      ? [...staticValue].map(character => ({
        character,
        assetRef: {
          ...baseAssetRef,
          imageIndex: baseAssetRef.imageIndex! + Number(character),
        },
      }))
      : [];
    return {
      mode: 'individual',
      textAtlasVariant: 'legacy-individual',
      value: staticValue ?? '?',
      gap: 0,
      ...(baseAssetRef ? { baseAssetRef } : {}),
      assetContract: baseAssetRef && staticValue ? 'unverified' : 'blocked',
      ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
      ...(invalidFields.length > 0 ? { invalidFields } : {}),
      glyphs,
    };
  }

  const widthSpan = keyedValue(values, 'iwidth');
  const heightSpan = keyedValue(values, 'iheight');
  const positiveAtlasInteger = (
    value: ValueSpan | undefined,
    field: 'glyph-width' | 'glyph-height',
    maximum = Number.MAX_SAFE_INTEGER
  ): number | undefined => {
    if (!value || !value.raw.trim()) {
      push(invalidFields, field);
      return undefined;
    }
    if (isDynamic(value)) {
      push(dynamicFields, field);
      return undefined;
    }
    const parsed = numericValue(value);
    if (!Number.isSafeInteger(parsed) || parsed! <= 0 || parsed! > maximum) {
      push(invalidFields, field);
      return undefined;
    }
    return parsed;
  };
  const glyphWidth = positiveAtlasInteger(
    widthSpan, 'glyph-width', Math.floor(Number.MAX_SAFE_INTEGER / 9)
  );
  const glyphHeight = positiveAtlasInteger(heightSpan, 'glyph-height');
  const glyphs = staticValue ? [...staticValue].map(character => {
    const digit = Number(character);
    return {
      character,
      ...(glyphWidth !== undefined ? { sourceX: digit * glyphWidth } : {}),
      ...(baseAssetRef && glyphWidth !== undefined && glyphHeight !== undefined
        ? { assetRef: { ...baseAssetRef } }
        : {}),
    };
  }) : [];
  return {
    mode: 'atlas',
    textAtlasVariant: 'newui-atlas',
    value: staticValue ?? '?',
    gap: 0,
    ...(glyphWidth !== undefined ? { glyphWidth } : {}),
    ...(glyphHeight !== undefined ? { glyphHeight } : {}),
    ...(baseAssetRef ? { baseAssetRef } : {}),
    assetContract: baseAssetRef && staticValue
      && glyphWidth !== undefined && glyphHeight !== undefined ? 'unverified' : 'blocked',
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    glyphs,
  };
}

function statementModelPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogModelPreview | undefined {
  if (schema.id !== 'newui-uimodel-996pc') return undefined;
  const partDefinitions = [
    ['cloth', '衣服', 'clothid', 'cloth-id'],
    ['weapon', '武器', 'weaponid', 'weapon-id'],
    ['head', '头盔', 'headid', 'head-id'],
    ['cap', '斗笠', 'capid', 'cap-id'],
    ['shield', '盾牌', 'shieldid', 'shield-id'],
    ['veil', '面巾', 'veilid', 'veil-id'],
  ] as const;
  const effectDefinitions = [
    ['cloth', 'clotheffectid', 'cloth-effect'],
    ['weapon', 'weaponeffectid', 'weapon-effect'],
    ['head', 'headeffectid', 'head-effect'],
    ['cap', 'capeffectid', 'cap-effect'],
    ['shield', 'shieldeffectid', 'shield-effect'],
    ['veil', 'veileffectid', 'veil-effect'],
  ] as const;
  const dynamicFields: DialogModelField[] = [];
  const invalidFields: DialogModelField[] = [];
  const dynamic = (value: ValueSpan | undefined): boolean => Boolean(value && /<\$/i.test(value.raw));

  const sexSpan = keyedValue(values, 'sex');
  const rawSex = numericValue(sexSpan);
  let sex: number | undefined;
  if (sexSpan) {
    if (dynamic(sexSpan)) dynamicFields.push('sex');
    else if (rawSex === 0 || rawSex === 1) sex = rawSex;
    else invalidFields.push('sex');
  }

  const scaleSpan = keyedValue(values, 'scale');
  const rawScale = numericValue(scaleSpan);
  let scale = 1;
  if (scaleSpan) {
    if (dynamic(scaleSpan)) dynamicFields.push('scale');
    else if (rawScale !== undefined && Number.isFinite(rawScale) && rawScale > 0) scale = rawScale;
    else invalidFields.push('scale');
  }

  const layers = partDefinitions.flatMap(([role, label, key, field]) => {
    const value = keyedValue(values, key);
    if (!value) return [];
    if (dynamic(value)) {
      dynamicFields.push(field);
      return [];
    }
    const looks = numericValue(value);
    const reference = looks !== undefined && Number.isInteger(looks) && looks > 0
      ? resolveStateItemImageReference(looks)
      : undefined;
    if (!reference) {
      invalidFields.push(field);
      return [];
    }
    return [{
      role,
      label,
      looks: reference.looks,
      assetRef: {
        archiveName: reference.pakName,
        imageIndex: reference.imageIndex,
      },
    }];
  });

  const hairSpan = keyedValue(values, 'hairid');
  const rawHairId = numericValue(hairSpan);
  let hairId: number | undefined;
  if (hairSpan) {
    if (dynamic(hairSpan)) dynamicFields.push('hair-id');
    else if (rawHairId !== undefined && Number.isSafeInteger(rawHairId) && rawHairId >= 0) {
      hairId = rawHairId;
    } else invalidFields.push('hair-id');
  }

  const binaryField = (
    key: string,
    field: 'not-show-mold' | 'not-show-hair'
  ): boolean | undefined => {
    const value = keyedValue(values, key);
    if (!value) return undefined;
    if (dynamic(value)) {
      dynamicFields.push(field);
      return undefined;
    }
    const raw = cleanStaticValue(value);
    if (/^true$/i.test(raw || '')) return true;
    if (/^false$/i.test(raw || '')) return false;
    invalidFields.push(field);
    return undefined;
  };
  const notShowMold = binaryField('notshowmold', 'not-show-mold');
  const notShowHair = binaryField('notshowhair', 'not-show-hair');

  const effectConfigs: NonNullable<DialogModelPreview['effectConfigs']> = {};
  for (const [role, key, field] of effectDefinitions) {
    const value = keyedValue(values, key);
    if (!value) continue;
    const raw = stripValueSuffix(value.raw).trim();
    if (!raw) {
      invalidFields.push(field);
      continue;
    }
    effectConfigs[role] = raw;
    if (dynamic(value)) dynamicFields.push(field);
  }

  return {
    variant: 'ui-model-996pc',
    ...(sex !== undefined ? { sex } : {}),
    scale,
    layers,
    ...(hairId !== undefined ? { hairId } : {}),
    ...(notShowMold !== undefined ? { notShowMold } : {}),
    ...(notShowHair !== undefined ? { notShowHair } : {}),
    ...(Object.keys(effectConfigs).length > 0 ? { effectConfigs } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields: [...new Set(dynamicFields)] } : {}),
    ...(invalidFields.length > 0 ? { invalidFields: [...new Set(invalidFields)] } : {}),
  };
}

function statementMenuPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogMenuPreview | undefined {
  if (schema.id !== 'newui-menuitem-996pc') return undefined;
  const itemSpan = keyedValue(values, 'itemname');
  const selectedSpan = keyedValue(values, 'select');
  const menuIdSpan = keyedValue(values, 'menuid');
  const linkSpan = keyedValue(values, 'link');
  const directionSpan = keyedValue(values, 'direction');
  const itemHeightSpan = keyedValue(values, 'itemhei');
  const maxHeightSpan = keyedValue(values, 'maxhei');
  const fontColorSpan = keyedValue(values, 'fontcolor');
  const selectedColorSpan = keyedValue(values, 'selectcolor');
  const rawItems = cleanStaticValue(itemSpan);
  const items = (rawItems || '').split('#').map(value => value.trim()).filter(Boolean);
  const selected = cleanStaticValue(selectedSpan) || items[0] || '请选择';
  const directionValue = numericValue(directionSpan);
  const itemHeightValue = numericValue(itemHeightSpan);
  const maxHeightValue = numericValue(maxHeightSpan);
  const fontColor = statementValueColor(fontColorSpan);
  const selectedColor = statementValueColor(selectedColorSpan);
  const defaultFields: NonNullable<DialogMenuPreview['defaultFields']> = [];
  const dynamicFields: NonNullable<DialogMenuPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogMenuPreview['invalidFields']> = [];

  let menuId: string | undefined;
  if (menuIdSpan) {
    if (/<\$/i.test(menuIdSpan.raw)) {
      dynamicFields.push('menuid');
    } else {
      const candidate = cleanStaticValue(menuIdSpan);
      if (candidate && /^S(?:\d+|\$[^\s|<>]+)$/i.test(candidate)) menuId = candidate;
      else invalidFields.push('menuid');
    }
  }
  let link: string | undefined;
  if (linkSpan) {
    if (/<\$/i.test(linkSpan.raw)) dynamicFields.push('link');
    else link = statementEventLink(values, schema);
  }

  const classifyUnavailable = (
    span: ValueSpan,
    field: NonNullable<DialogMenuPreview['dynamicFields']>[number]
  ) => {
    if (/<\$/i.test(span.raw)) dynamicFields.push(field);
    else if (field === 'direction' || field === 'itemhei' || field === 'maxhei') {
      invalidFields.push(field);
    }
  };
  if (itemSpan && rawItems === undefined && /<\$/i.test(itemSpan.raw)) {
    dynamicFields.push('itemname');
  }
  if (selectedSpan && cleanStaticValue(selectedSpan) === undefined && /<\$/i.test(selectedSpan.raw)) {
    dynamicFields.push('select');
  }
  let directionStatus: 'default' | 'static' | 'dynamic' | 'invalid';
  let direction: 0 | 1 = 0;
  if (!directionSpan) {
    directionStatus = 'default';
    defaultFields.push('direction');
  } else if (/<\$/i.test(directionSpan.raw)) {
    directionStatus = 'dynamic';
    dynamicFields.push('direction');
  } else if (directionValue === 0 || directionValue === 1) {
    directionStatus = 'static';
    direction = directionValue;
  } else {
    directionStatus = 'invalid';
    invalidFields.push('direction');
  }
  let itemHeight = MENU_ITEM_PREVIEW_HEIGHT;
  if (!itemHeightSpan) {
    defaultFields.push('itemhei');
  } else if (itemHeightValue !== undefined && Number.isFinite(itemHeightValue) && itemHeightValue > 0) {
    itemHeight = itemHeightValue;
  } else {
    classifyUnavailable(itemHeightSpan, 'itemhei');
  }
  let maxHeight: number | undefined;
  if (maxHeightSpan) {
    if (maxHeightValue !== undefined && Number.isFinite(maxHeightValue) && maxHeightValue > 0) {
      maxHeight = maxHeightValue;
    } else {
      classifyUnavailable(maxHeightSpan, 'maxhei');
    }
  }
  if (fontColorSpan && fontColor === undefined && /<\$/i.test(fontColorSpan.raw)) {
    dynamicFields.push('fontcolor');
  }
  if (selectedColorSpan && selectedColor === undefined && /<\$/i.test(selectedColorSpan.raw)) {
    dynamicFields.push('selectcolor');
  }
  const assetDiagnostics = [
    menuAssetDiagnostic(
      keyedValue(values, 'img'), 'img', 'background', [2000], directionStatus, direction
    ),
    menuAssetDiagnostic(
      keyedValue(values, 'arrowimg'), 'arrowimg', 'arrow', [1448, 1451],
      directionStatus, direction
    ),
    menuAssetDiagnostic(
      keyedValue(values, 'selectimg'), 'selectimg', 'selected', [2047],
      directionStatus, direction
    ),
    menuAssetDiagnostic(
      keyedValue(values, 'listimg'), 'listimg', 'list-background', [2000],
      directionStatus, direction
    ),
  ];
  for (const diagnostic of assetDiagnostics) {
    if (diagnostic.sourceStatus === 'default') defaultFields.push(diagnostic.field);
    else if (diagnostic.sourceStatus === 'dynamic') dynamicFields.push(diagnostic.field);
    else if (diagnostic.sourceStatus === 'invalid') invalidFields.push(diagnostic.field);
  }
  return {
    items,
    selected,
    ...(menuId ? { menuId } : {}),
    ...(link ? { link } : {}),
    direction,
    itemHeight,
    ...(maxHeight !== undefined ? { maxHeight } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(selectedColor ? { selectedColor } : {}),
    assetDiagnostics,
    ...(dynamicFields.length > 0 ? { dynamic: true } : {}),
    ...(defaultFields.length > 0 ? { defaultFields } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function menuDefaultPreviewWarning(preview: DialogMenuPreview | undefined): string | undefined {
  if (!preview?.defaultFields?.length) return undefined;
  const warnings: string[] = [];
  if (preview.defaultFields.includes('direction')) {
    warnings.push(
      '996PC 手册未公开 MenuItem 未填写 direction 时的客户端默认方向，Ctrl+F12 按 direction=0（下拉）预览回退'
    );
  }
  if (preview.defaultFields.includes('itemhei')) {
    warnings.push(
      `996PC 手册未公开 MenuItem 未填写 itemhei 时的客户端默认高度，Ctrl+F12 使用 ${MENU_ITEM_PREVIEW_HEIGHT}px 预览回退`
    );
  }
  return warnings.join('；') || undefined;
}

function parseMenuResourceCandidates(value: string): DialogAssetReference[] | undefined {
  const match = /^(.*?)(\d+)(?:[#，,\s]+(\d+))?\s*$/u.exec(value.trim());
  if (!match) return undefined;
  const prefix = match[1];
  let archiveName = 'NewopUI';
  if (prefix) {
    const separator = /[-:/,#]\s*$/u.exec(prefix);
    if (!separator) return undefined;
    archiveName = prefix.slice(0, separator.index).trim();
    if (!archiveName || !/^[^\s|<>:#,，/]+$/u.test(archiveName)) return undefined;
  }
  const indexes = [match[2], match[3]].filter((part): part is string => Boolean(part)).map(Number);
  if (indexes.some(index => !Number.isSafeInteger(index) || index < 0)) return undefined;
  return indexes.map(imageIndex => ({ archiveName, imageIndex }));
}

function menuAssetDiagnostic(
  value: ValueSpan | undefined,
  field: DialogMenuAssetField,
  role: DialogMenuAssetDiagnostic['role'],
  defaultIndexes: readonly number[],
  directionStatus: 'default' | 'static' | 'dynamic' | 'invalid',
  direction: 0 | 1
): DialogMenuAssetDiagnostic {
  const raw = value ? stripValueSuffix(value.raw).trim() : '';
  const directionalUnknown = field === 'arrowimg'
    && (directionStatus === 'dynamic' || directionStatus === 'invalid');
  if (!value || !raw) {
    if (directionalUnknown) {
      return {
        field,
        role,
        sourceStatus: directionStatus,
        status: directionStatus,
        message: 'arrowimg 使用方向相关默认图，但 direction 不能静态确定',
      };
    }
    const imageIndex = defaultIndexes[Math.min(direction, defaultIndexes.length - 1)];
    return {
      field,
      role,
      sourceStatus: 'default',
      status: 'default',
      assetRef: { archiveName: 'NewopUI', imageIndex },
      message: `帮助公开的空值默认 NewopUI-${imageIndex}`,
    };
  }
  if (/<\$/i.test(raw)) {
    return {
      field,
      role,
      sourceStatus: 'dynamic',
      status: 'dynamic',
      message: '动态素材不借用 MOV 当前值',
    };
  }
  const candidates = parseMenuResourceCandidates(raw);
  if (!candidates?.length) {
    return {
      field,
      role,
      sourceStatus: 'invalid',
      status: 'invalid',
      message: '显式非法素材值不会回退为帮助的空值默认',
    };
  }
  if (field === 'arrowimg' && candidates.length > 1 && directionalUnknown) {
    return {
      field,
      role,
      sourceStatus: directionStatus,
      status: directionStatus,
      message: '双候选箭头素材需要静态 direction 才能选择',
    };
  }
  const assetRef = candidates[Math.min(direction, candidates.length - 1)];
  return {
    field,
    role,
    sourceStatus: 'static',
    status: 'static',
    assetRef,
    message: `显式静态素材 ${assetRef.archiveName}-${assetRef.imageIndex}`,
  };
}

function statementTooltipPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogTooltipPreview | undefined {
  let raw: string | undefined;
  let offsetX = 0;
  let offsetY = 0;
  if (schema.syntax === 'key-value') {
    raw = keyedValue(values, 'tips')?.raw;
    offsetX = numericValue(keyedValue(values, 'tipsx')) ?? 0;
    offsetY = numericValue(keyedValue(values, 'tipsy')) ?? 0;
  } else {
    raw = legacyPipeTooltipValue(values, schema)
      ?? explicitPositionalTooltipValue(values, schema);
  }
  return raw ? parseDialogTooltipPreview(raw, offsetX, offsetY) : undefined;
}

function legacyPipeTooltipValue(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): string | undefined {
  if (schema.id === 'container-mtext') return undefined;
  const command = statementCommand(schema);
  const supportsPipeTooltip = [
    'TEXT', 'IMG', 'IMGEX', 'PLAYIMG', 'PLAYIMGEX', 'STATEITEM', 'DNITEMS',
  ].includes(command);
  if (!supportsPipeTooltip) return undefined;
  for (const value of values.positional) {
    const pipe = findTopLevelPipe(value.raw);
    if (pipe >= 0) return value.raw.slice(pipe + 1);
  }
  return undefined;
}

function explicitPositionalTooltipValue(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): string | undefined {
  if (schema.id === 'item-box') return positionalValue(values, 9)?.raw;
  if (/^(?:hero-)?custom-item-preview$/.test(schema.id)) {
    return positionalValue(values, 7)?.raw;
  }
  if (schema.engine !== 'GEE') return undefined;
  const command = statementCommand(schema);
  if (command === 'PLAYIMG') return positionalValue(values, 8)?.raw;
  if (command === 'PLAYIMGEX') return positionalValue(values, 9)?.raw;
  return undefined;
}

function statementCommand(schema: DialogStatementSchema): string {
  return schema.token.replace(/^<&?/, '').toUpperCase();
}

function parseDialogTooltipPreview(
  value: string,
  offsetX: number,
  offsetY: number
): DialogTooltipPreview | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  let content = raw.replace(/\s*\/@[^\s>]*(?:\([^)]*\))?\s*$/, '').trim();
  const item = /^ITEMSHOW#(\d+)#(\d+)\s*$/i.exec(content);
  if (item) {
    const itemIndex = Number(item[1]);
    const itemMode = Number(item[2]);
    return {
      raw,
      kind: 'item',
      lines: [[{ text: `物品 IDX ${itemIndex} · 模式 ${itemMode}` }]],
      offsetX,
      offsetY,
      itemIndex,
      itemMode,
    };
  }

  content = decodeTooltipWhitespace(content);
  if (/^<[^<>]*>$/.test(content)) content = content.slice(1, -1).trim();
  if (/^\{[^{}]*\/FCOLOR\s*=/i.test(content) && content.endsWith('}')) {
    content = content.slice(1, -1).trim();
  }
  let defaultColor: string | undefined;
  const colorSuffix = /\/FCOLOR\s*=\s*(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d+)\s*$/i.exec(content);
  if (colorSuffix) {
    defaultColor = tooltipColor(colorSuffix[1]);
    content = content.slice(0, colorSuffix.index).trimEnd();
  }
  if (!content) return undefined;

  const lines = content
    .replace(/\\\\/g, '^')
    .split(/\^|\r?\n/)
    .map(line => tooltipLineRuns(line, defaultColor));
  return { raw, kind: 'text', lines, offsetX, offsetY };
}

function tooltipLineRuns(value: string, inheritedColor?: string): DialogTextRun[] {
  let line = value;
  let color = inheritedColor;
  if (/^#\d+#/.test(line)) line = line.slice(1);
  const prefix = /^\s*(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d+)#/.exec(line);
  if (prefix) {
    color = tooltipColor(prefix[1]);
    line = line.slice(prefix[0].length);
  }

  const runs: DialogTextRun[] = [];
  const inline = new RegExp(
    `\\{([^{}]*?)\\|(${DIALOG_SINGLE_COLOR_PATTERN})\\}`
      + `|\\{([^{}]*?)\\/(FCOLOR|SCOLOR|AUTOCOLOR)\\s*=\\s*(${DIALOG_COLOR_LIST_PATTERN})\\}`
      + `|<([^<>]*?)\\/(FCOLOR|SCOLOR|AUTOCOLOR)\\s*=\\s*(${DIALOG_COLOR_LIST_PATTERN})>`,
    'gi'
  );
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(line)) !== null) {
    if (match.index > cursor) runs.push({ text: line.slice(cursor, match.index), ...(color ? { color } : {}) });
    if (match[1] !== undefined) {
      runs.push(dialogTextRun(match[1], match[2], 'FCOLOR'));
    } else if (match[3] !== undefined) {
      runs.push(dialogTextRun(match[3], match[5], match[4]));
    } else {
      runs.push(dialogTextRun(match[6] ?? '', match[8], match[7]));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length || runs.length === 0) {
    runs.push({ text: line.slice(cursor), ...(color ? { color } : {}) });
  }
  return runs;
}

const DIALOG_SINGLE_COLOR_PATTERN = '(?:\\$[0-9A-F]{6}|#[0-9A-F]{6}|[+-]?\\d+)';
const DIALOG_COLOR_LIST_PATTERN = `${DIALOG_SINGLE_COLOR_PATTERN}(?:\\s*,\\s*${DIALOG_SINGLE_COLOR_PATTERN})*`;

function dialogTextRun(
  text: string,
  colorSource: string,
  mode: string
): DialogTextRun {
  const colorValues = splitDialogColorValues(colorSource);
  const colorFrames = parseDialogColors(colorSource);
  if (/^AUTOCOLOR$/i.test(mode) && colorValues && colorFrames) {
    return {
      text,
      colorValues,
      colorFrames,
      colorIntervalMs: 1000,
    };
  }
  const color = colorFrames?.[0];
  return { text, ...(color ? { color } : {}) };
}

function legacyTextColorStyle(
  values: ParsedStatementValues
): { mode: 'FCOLOR' | 'SCOLOR' | 'AUTOCOLOR'; value: string } | undefined {
  const source = values.positional.map(value => value.raw).join(':');
  const match = new RegExp(
    `(?:\\{|;)\\s*(FCOLOR|SCOLOR|AUTOCOLOR)\\s*=\\s*(${DIALOG_COLOR_LIST_PATTERN})(?=\\s*(?:;|\\}))`,
    'i'
  ).exec(source);
  if (!match) return undefined;
  return {
    mode: match[1].toUpperCase() as 'FCOLOR' | 'SCOLOR' | 'AUTOCOLOR',
    value: match[2],
  };
}

function legacyTextStyleValue(
  values: ParsedStatementValues,
  name: 'FSIZE' | 'FNAME' | 'FBOLD' | 'SIMPLENUM'
): ValueSpan | undefined {
  const source = values.positional.map(value => value.raw).join(':');
  const match = new RegExp(
    `(?:\\{|;)\\s*${name}\\s*=\\s*([^;}]*)`,
    'i'
  ).exec(source);
  if (!match) return undefined;
  const raw = match[1].trim();
  return { start: 0, end: raw.length, raw };
}

function legacyTextColorValue(values: ParsedStatementValues): ValueSpan | undefined {
  const source = values.positional.map(value => value.raw).join(':');
  const match = /(?:\{|;)\s*(?:FCOLOR|SCOLOR|AUTOCOLOR)\s*=\s*([^;}]*)/i.exec(source);
  if (!match) return undefined;
  const raw = match[1].trim();
  return { start: 0, end: raw.length, raw };
}

function tooltipColor(value: string): string | undefined {
  if (/^\d+$/.test(value)) return legendColor(Number(value));
  if (/^#[0-9A-F]{6}$/i.test(value)) return value;
  if (/^\$[0-9A-F]{6}$/i.test(value)) return bgrHexToCss(value.slice(1));
  return undefined;
}

function decodeTooltipWhitespace(value: string): string {
  return value
    .replace(/&#x20;|&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function interactiveAssetReferences(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetLayer[] {
  let hover: number | undefined;
  let pressed: number | undefined;
  let base: Omit<DialogAssetReference, 'imageIndex'> | undefined;
  if (/^imgex-(?:absolute|relative-996pc)$/.test(schema.id)) {
    const willIndex = numericValue(positionalValue(values, 1));
    if (willIndex !== undefined) base = { willIndex };
    hover = numericValue(positionalValue(values, 3));
    pressed = numericValue(positionalValue(values, 4));
  } else if (schema.id === 'newui-button-996pc') {
    const archiveName = cleanStaticValue(keyedValue(values, 'wil'));
    if (archiveName) base = { archiveName };
    hover = numericValue(keyedValue(values, 'pcmimg'));
    pressed = numericValue(keyedValue(values, 'pcpimg'));
  }
  if (!base) return [];
  const result: DialogAssetLayer[] = [];
  if (hover !== undefined) result.push({ role: 'hover', assetRef: { ...base, imageIndex: hover } });
  if (pressed !== undefined) result.push({ role: 'pressed', assetRef: { ...base, imageIndex: pressed } });
  return result;
}

function statementAnimationPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  primaryAsset: DialogAssetReference | undefined
): DialogAnimationPreview | undefined {
  const mapping = schema.animation;
  if (!mapping) return undefined;
  const parameter = (index: number | undefined, key: string | undefined): ValueSpan | undefined => (
    schema.syntax === 'key-value' ? keyedValue(values, key) : positionalValue(values, index)
  );
  const frameSpan = parameter(mapping.frameCountParameter, mapping.frameCountKey);
  const intervalSpan = parameter(mapping.intervalParameter, mapping.intervalKey);
  const repeatSpan = parameter(mapping.repeatParameter, mapping.repeatKey);
  const drawModeSpan = parameter(mapping.drawModeParameter, mapping.drawModeKey);
  const repairModeSpan = positionalValue(values, mapping.repairModeParameter);
  const captionSpan = positionalValue(values, mapping.captionParameter);
  const submitSpan = positionalValue(values, mapping.submitParameter);
  const resourceSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.willKey)
    : positionalValue(values, schema.willParameter);
  const startSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.imageKey)
    : positionalValue(values, schema.imageParameter);
  const rawFrameCount = numericValue(frameSpan) ?? primaryAsset?.frameCount;
  const rawInterval = numericValue(intervalSpan);
  const rawRepeat = numericValue(repeatSpan);
  const dynamicFields: DialogAnimationField[] = [];
  const invalidFields: DialogAnimationField[] = [];
  const addField = (target: DialogAnimationField[], field: DialogAnimationField): void => {
    if (!target.includes(field)) target.push(field);
  };
  const classifyNumber = (
    span: ValueSpan | undefined,
    value: number | undefined,
    field: DialogAnimationField,
    valid: (candidate: number) => boolean
  ): boolean => {
    if (!span) return value !== undefined && valid(value);
    if (/<\$/i.test(span.raw)) {
      addField(dynamicFields, field);
      return false;
    }
    if (value === undefined || !valid(value)) {
      addField(invalidFields, field);
      return false;
    }
    return true;
  };
  const classifyRequiredResource = (): void => {
    if (!resourceSpan) {
      addField(invalidFields, 'resource');
      return;
    }
    if (/<\$/i.test(resourceSpan.raw)) {
      addField(dynamicFields, 'resource');
      return;
    }
    const resource = cleanStaticValue(resourceSpan);
    const numericResource = numericValue(resourceSpan);
    const valid = schema.syntax === 'key-value'
      ? Boolean(resource)
      : Number.isInteger(numericResource) && Number(numericResource) >= 0;
    if (!valid) addField(invalidFields, 'resource');
  };
  classifyRequiredResource();
  classifyNumber(startSpan, numericValue(startSpan), 'start', value => (
    Number.isInteger(value) && value >= 0
  ));
  const frameValid = classifyNumber(
    frameSpan, rawFrameCount, 'frame-count', value => Number.isInteger(value) && value > 0
  );
  const intervalValid = classifyNumber(
    intervalSpan, rawInterval, 'interval', value => Number.isFinite(value) && value > 0
  );
  const repeatValid = !repeatSpan || classifyNumber(
    repeatSpan, rawRepeat, 'repeat', value => Number.isInteger(value) && value >= 0
  );
  const frameCount = frameValid ? rawFrameCount! : 1;
  const intervalMs = intervalValid ? rawInterval! : 100;
  const previewIntervalMs = Math.max(16, Math.min(60000, intervalMs));
  const repeatCount = repeatValid ? rawRepeat : undefined;

  const finishFrameSpan = keyedValue(values, mapping.finishFrameKey);
  const finishHideSpan = keyedValue(values, mapping.finishHideKey);
  const scaleSpan = keyedValue(values, mapping.scaleKey);
  const slowCountSpan = keyedValue(values, mapping.slowCountKey);
  const rawFinishFrame = numericValue(finishFrameSpan);
  const rawFinishHide = numericValue(finishHideSpan);
  const rawScale = numericValue(scaleSpan);
  const rawDrawMode = numericValue(drawModeSpan);
  const rawRepairMode = numericValue(repairModeSpan);
  const rawSlowCount = numericValue(slowCountSpan);
  const finishFrameValid = finishFrameSpan && classifyNumber(
    finishFrameSpan,
    rawFinishFrame,
    'finish-frame',
    value => Number.isInteger(value) && value >= 0 && value <= frameCount
  );
  const finishHideValid = finishHideSpan && classifyNumber(
    finishHideSpan, rawFinishHide, 'finish-hide', value => value === 0 || value === 1
  );
  const scaleValid = scaleSpan && classifyNumber(
    scaleSpan, rawScale, 'scale', value => Number.isFinite(value) && value > 0
  );
  const drawModeValid = drawModeSpan && classifyNumber(
    drawModeSpan, rawDrawMode, 'draw-mode', value => (
      Number.isInteger(value) && value >= mapping.drawModeMin && value <= mapping.drawModeMax
    )
  );
  const repairModeValid = repairModeSpan && classifyNumber(
    repairModeSpan, rawRepairMode, 'repair-mode', value => value === 0 || value === 1
  );
  const slowCountValid = slowCountSpan && classifyNumber(
    slowCountSpan, rawSlowCount, 'slow-count', value => Number.isInteger(value) && value >= 0
  );
  const link = statementEventLink(values, schema);
  if (statementLinkIsDynamic(values, schema)) addField(dynamicFields, 'link');
  const staticText = (
    span: ValueSpan | undefined,
    field: 'caption' | 'submit'
  ): string | undefined => {
    if (!span) return undefined;
    if (/<\$/i.test(span.raw)) {
      addField(dynamicFields, field);
      return undefined;
    }
    const text = cleanStaticValue(span);
    if (text === undefined) addField(invalidFields, field);
    return text;
  };
  const caption = staticText(captionSpan, 'caption');
  const title = mapping.variant === 'gom-playimg'
    ? parseGomAnimationTitle(caption)
    : undefined;
  const submitIds = staticText(submitSpan, 'submit');
  const finishPolicyConflict = Boolean(
    finishFrameValid && finishHideValid && rawFinishHide === 1
  );
  const unverifiedKeys = mapping.variant === '996pc-frames'
    ? ['scale']
    : mapping.variant === '996pc-effect'
      ? ['finishframe', 'finishhide', 'slowcount']
      : [];
  const unverifiedFields = unverifiedKeys.filter(key => Boolean(keyedValue(values, key)));
  const staticFirstFrameOnly = dynamicFields.length > 0 || invalidFields.length > 0;
  return {
    variant: mapping.variant,
    frameCount,
    intervalMs,
    previewIntervalMs,
    offsetPolicy: mapping.offsetPolicy,
    finiteCompletion: mapping.finiteCompletion,
    ...(repeatCount !== undefined ? { repeatCount } : {}),
    ...(finishFrameValid ? { finishFrame: rawFinishFrame, finishFrameIndexBasis: 'unknown' } : {}),
    ...(finishHideValid ? { finishHide: rawFinishHide === 1 } : {}),
    ...(scaleValid ? { scale: rawScale } : {}),
    ...(drawModeValid ? { drawMode: rawDrawMode } : {}),
    ...(repairModeValid ? {
      repairMode: rawRepairMode,
      repairModeEvidence: mapping.repairModeEvidence,
    } : {}),
    ...(caption !== undefined ? { caption } : {}),
    ...(title ? { title } : {}),
    ...(submitIds !== undefined ? { submitIds } : {}),
    ...(slowCountValid ? { slowCount: rawSlowCount } : {}),
    ...(link ? { link } : {}),
    ...(staticFirstFrameOnly ? { staticFirstFrameOnly: true } : {}),
    ...(finishPolicyConflict ? { finishPolicyConflict: true } : {}),
    ...(unverifiedFields.length > 0 ? { unverifiedFields } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function parseGomAnimationTitle(
  value: string | undefined
): NonNullable<DialogAnimationPreview['title']> | undefined {
  if (!value?.endsWith('#')) return undefined;
  const match = /^(.*),([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([^,]+)#$/.exec(value);
  if (!match) return undefined;
  const text = match[1].trim();
  const offsetX = Number(match[2]);
  const offsetY = Number(match[3]);
  const colorValue = match[4].trim();
  const color = tooltipColor(colorValue);
  if (!text || !Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !color) return undefined;
  return { raw: value, text, offsetX, offsetY, colorValue, color };
}

function animationBoundaryWarnings(preview: DialogAnimationPreview | undefined): string[] {
  if (!preview) return [];
  const warnings: string[] = [];
  if (preview.intervalMs !== preview.previewIntervalMs) {
    warnings.push(
      `源码动画间隔 ${preview.intervalMs}ms 已保留；浏览器预览为安全性限幅到 ${preview.previewIntervalMs}ms`
    );
  }
  if (preview.unverifiedFields?.length) {
    warnings.push(
      `${preview.variant === '996pc-frames' ? 'Frames' : 'Effect'} 的 ${preview.unverifiedFields.join('、')} 不属于该控件已公开字段，Ctrl+F12 仅在参数表保留原文，不赋予动画语义`
    );
  }
  if (preview.repairModeEvidence === 'update-log') {
    warnings.push(
      'GOM 第10参数“读取素材坐标偏移”仅有官方更新日志证据，尚无本机真实脚本样本覆盖兼容版本'
    );
  }
  if (preview.finishFrame !== undefined) {
    warnings.push(
      'Frames finishframe 已保留，但手册未说明 0/1 基、相对/绝对索引和越界行为，Ctrl+F12 不擅自跳帧'
    );
  }
  if (preview.invalidFields?.includes('finish-frame')) {
    warnings.push(
      'Frames finishframe 超出当前动画帧数可同时容纳的 0 基/1 基范围，已按无效参数拒绝，不做 clamp'
    );
  }
  if (preview.finishPolicyConflict) {
    warnings.push(
      'Frames 同时设置 finishframe 与 finishhide 时的客户端优先级未公开，Ctrl+F12 不伪造冲突完成状态'
    );
  }
  if (Number(preview.slowCount) > 0) {
    warnings.push(
      'Frames slowcount 的放缓算法和曲线未公开，参数已保留但 Ctrl+F12 不伪造减速'
    );
  }
  if (preview.variant === '996pc-frames') {
    warnings.push(
      'Frames 手册的 loop 说明自相矛盾；Ctrl+F12 采用 0/省略为循环、正数为播放次数的可见预览约定'
    );
  }
  if (preview.drawMode !== undefined && preview.drawMode > 0) {
    warnings.push(
      preview.variant.startsWith('lfm-') && preview.drawMode >= 2
        ? `LFM 绘制模式 ${preview.drawMode} 的底层层级已保留，但静态 Webview 无客户端场景层，不能证明真实遮挡顺序`
        : `绘制模式 ${preview.drawMode} 已保留，但手册未公开精确像素混合公式，Ctrl+F12 不伪造 CSS 混合`
    );
  }
  if (preview.finiteCompletion === 'unknown' && Number(preview.repeatCount) > 0) {
    warnings.push(
      '手册未公开指定次数结束后的隐藏、停帧或复位行为；Ctrl+F12 完成后停留最后一个时间槽作为预览约定'
    );
  }
  if (preview.variant === '996pc-effect' && !Number(preview.repeatCount)) {
    warnings.push(
      'Effect 手册未公开 count=0 或省略时的默认行为；Ctrl+F12 采用循环预览约定，不宣称等同客户端'
    );
  }
  if (preview.submitIds) {
    warnings.push(
      `输入框提交列表 ${preview.submitIds} 已保留；Ctrl+F12 不执行客户端提交或服务器标签`
    );
  }
  if (preview.variant === 'gom-playimg' && preview.caption && !preview.title) {
    warnings.push(
      'GOM 第9参数未形成有效的“标题,X,Y,颜色#”结构，按旧输入框检查兼容参数保留，不伪造可见标题'
    );
  }
  if (preview.link) {
    warnings.push(`动画点击标签 ${preview.link} 已保留；Ctrl+F12 不执行服务器脚本`);
  }
  return warnings;
}

function statementParameters(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogElementParameter[] {
  if (schema.syntax === 'positional') {
    const parameters = values.positional.map((value, index) => ({
      index: index + 1,
      name: schema.parameterMeanings.get(index + 1)
        || schema.declaredParameters[index]?.description
        || `参数${index + 1}`,
      value: displayParameterValue(value.raw),
    }));
    const last = values.positional[values.positional.length - 1];
    const link = /\/@([^|>{}\s]+)/.exec(last?.raw || '')?.[1];
    const declaredLink = [...schema.parameterMeanings.entries()].find(([, meaning]) => (
      /标签/.test(meaning)
    ));
    if (link && declaredLink) {
      parameters.push({
        index: declaredLink[0],
        name: declaredLink[1],
        value: link,
      });
    }
    return parameters;
  }

  return values.positional.flatMap((segment, index) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(segment.raw);
    if (!match) return [];
    const key = match[1];
    const declared = schema.declaredParameters.find(parameter => (
      [parameter.key, ...(parameter.aliases || [])]
        .filter(Boolean)
        .some(candidate => candidate!.toLowerCase() === key.toLowerCase())
    ));
    return [{
      index: index + 1,
      key,
      name: declared?.description || schema.parameterMeanings.get(index + 1) || key,
      value: displayParameterValue(match[2]),
    }];
  });
}

function statementEventLink(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): string | undefined {
  if (schema.syntax === 'key-value') {
    const link = cleanStaticValue(keyedValue(values, 'link'));
    if (!link) return undefined;
    return link.startsWith('@') ? link : `@${link}`;
  }
  const source = values.positional.map(value => value.raw).join(':');
  const match = /\/@([^|>{}\s]+)/.exec(source);
  if (!match) return undefined;
  return `@${match[1]}`;
}

function statementLinkIsDynamic(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): boolean {
  if (schema.syntax === 'key-value') {
    const link = keyedValue(values, 'link');
    return Boolean(link && /<\$/i.test(link.raw));
  }
  return values.positional.some(value => /\/@[^\r\n]*<\$/i.test(value.raw));
}

const COLOR_PARAMETER_KEYS = new Set([
  'color', 'colour', 'fcolor', 'fcolour',
  'outlinecolor', 'outlinecolour',
  'placecolor', 'placecolour',
  'fontcolor', 'fontcolour',
  'selectcolor', 'selectcolour',
  'titlecolor', 'titlecolour',
  'textcolor', 'textcolour',
  'bordercolor', 'bordercolour',
  'backgroundcolor', 'backgroundcolour', 'bgcolor',
]);

function statementColorBoundaryWarnings(
  parameters: readonly DialogElementParameter[],
  schema: DialogStatementSchema
): string[] {
  const warnings = new Set<string>();
  const inspect = (candidate: string, parameterName: string): void => {
    const value = candidate.trim().replace(/^\{\s*|\s*\}$/g, '');
    if (!value || /<\$/i.test(value) || /^[$#][0-9A-F]{6}$/i.test(value)) return;
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return;
    const index = Number(value);
    if (index === -1 && /背景|边框|background|border/i.test(parameterName)) return;
    const resolution = resolveLegendColorIndex(index);
    if (resolution.status === 'unset') {
      warnings.add(`颜色编号 ${index} 在官方默认 256 色表中未设置，Ctrl+F12 不猜测其 RGB`);
    } else if (resolution.status === 'out-of-range') {
      warnings.add(schema.engine === '996PC'
        ? `颜色编号 ${index} 超出内置 0-255 色表；需要 cfg_colour_style.xls 才能还原该自定义颜色，Ctrl+F12 当前不猜测`
        : `颜色编号 ${index} 超出内置 0-255 色表，Ctrl+F12 当前不猜测`);
    } else if (resolution.status === 'invalid') {
      warnings.add(`颜色值 ${value} 不是有效的整数色号，Ctrl+F12 当前不猜测`);
    }
  };

  for (const parameter of parameters) {
    const key = parameter.key?.toLowerCase();
    const colorParameter = Boolean(
      (key && COLOR_PARAMETER_KEYS.has(key))
      || /颜色|色值|colou?r/i.test(parameter.name)
    );
    if (colorParameter) {
      for (const value of parameter.value.split(',')) inspect(value, parameter.name);
    }
    const inlineColors = parameter.value.matchAll(
      /(?:FCOLou?R|COLou?R)\s*=\s*([$#][0-9A-F]{6}|[+-]?\d+(?:\.\d+)?)/gi
    );
    for (const match of inlineColors) inspect(match[1], 'FCOLOR');
  }
  return [...warnings];
}

function displayParameterValue(value: string): string {
  return value.trim().replace(/\s*\/@[^>]*$/, '').replace(/^['"]|['"]$/g, '');
}

interface ItemPreviewDiagnostics {
  dynamicFields: DialogItemPreviewField[];
  invalidFields: DialogItemPreviewField[];
}

function pushUniqueItemField(fields: DialogItemPreviewField[], field: DialogItemPreviewField): void {
  if (!fields.includes(field)) fields.push(field);
}

function itemValueIsDynamic(value: ValueSpan | undefined): boolean {
  return Boolean(value && /<\$/i.test(value.raw));
}

function itemNumericValue(
  value: ValueSpan | undefined,
  field: DialogItemPreviewField,
  diagnostics: ItemPreviewDiagnostics,
  valid: (parsed: number) => boolean = Number.isFinite
): number | undefined {
  if (!value) return undefined;
  if (itemValueIsDynamic(value)) {
    pushUniqueItemField(diagnostics.dynamicFields, field);
    return undefined;
  }
  const parsed = numericValue(value);
  if (parsed === undefined || !valid(parsed)) {
    pushUniqueItemField(diagnostics.invalidFields, field);
    return undefined;
  }
  return parsed;
}

function itemBinaryValue(
  value: ValueSpan | undefined,
  field: DialogItemPreviewField,
  diagnostics: ItemPreviewDiagnostics
): boolean | undefined {
  const parsed = itemNumericValue(
    value,
    field,
    diagnostics,
    candidate => candidate === 0 || candidate === 1
  );
  return parsed === undefined ? undefined : parsed === 1;
}

function itemTextValue(
  value: ValueSpan | undefined,
  field: DialogItemPreviewField,
  diagnostics: ItemPreviewDiagnostics
): string | undefined {
  if (!value) return undefined;
  if (itemValueIsDynamic(value)) {
    pushUniqueItemField(diagnostics.dynamicFields, field);
    return undefined;
  }
  const parsed = cleanStaticValue(value);
  if (parsed === undefined) pushUniqueItemField(diagnostics.invalidFields, field);
  return parsed;
}

function withItemDiagnostics<T extends DialogItemPreview>(
  preview: T,
  diagnostics: ItemPreviewDiagnostics
): T {
  return {
    ...preview,
    ...(diagnostics.dynamicFields.length > 0
      ? { dynamic: true, dynamicFields: diagnostics.dynamicFields }
      : {}),
    ...(diagnostics.invalidFields.length > 0
      ? { invalidFields: diagnostics.invalidFields }
      : {}),
  };
}

function itemBoxStdModeConstraint(
  value: ValueSpan | undefined,
  diagnostics: ItemPreviewDiagnostics
): Pick<DialogItemPreview, 'allowedStdModes' | 'acceptsAnyStdMode'> {
  if (!value) return {};
  if (itemValueIsDynamic(value)) {
    pushUniqueItemField(diagnostics.dynamicFields, 'stdmode');
    return {};
  }
  const raw = value.raw.trim();
  if (raw === '*') return { acceptsAnyStdMode: true };
  const parts = raw.split(',').map(part => part.trim());
  if (
    parts.length === 0
    || parts.some(part => !/^\d+$/.test(part))
  ) {
    pushUniqueItemField(diagnostics.invalidFields, 'stdmode');
    return {};
  }
  const allowedStdModes = [...new Set(parts.map(Number))];
  if (allowedStdModes.some(valueNumber => !Number.isSafeInteger(valueNumber) || valueNumber < 0)) {
    pushUniqueItemField(diagnostics.invalidFields, 'stdmode');
    return {};
  }
  return { allowedStdModes, acceptsAnyStdMode: false };
}

function statementItemPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogItemPreview | undefined {
  switch (schema.id) {
    case 'item-show': {
      const gom = schema.engine === 'GOM';
      const gee = schema.engine === 'GEE';
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const itemIndex = itemNumericValue(
        positionalValue(values, 1), 'itemid', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const quantity = itemNumericValue(
        positionalValue(values, 2), 'itemcount', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const frameValue = itemNumericValue(
        positionalValue(values, 5), 'bgtype', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const gray = itemBinaryValue(
        positionalValue(values, gom ? 6 : gee ? 7 : undefined), 'grey', diagnostics
      );
      const alignSpan = gom ? positionalValue(values, 7) : undefined;
      const alignCustom = gom ? itemBinaryValue(alignSpan, 'align', diagnostics) : undefined;
      const customWidth = gom ? itemNumericValue(
        positionalValue(values, 8), 'customwidth', diagnostics,
        value => Number.isFinite(value) && value > 0
      ) : undefined;
      const titleSpan = gom ? positionalValue(values, 9) : undefined;
      const titleMode = gom ? itemBinaryValue(titleSpan, 'title', diagnostics) : undefined;
      const sourceSpan = gom ? positionalValue(values, 10) : undefined;
      const useStdItem = gom ? itemBinaryValue(sourceSpan, 'source', diagnostics) : undefined;
      const effectSpan = gom ? positionalValue(values, 11) : undefined;
      const drawEffect = gom ? itemBinaryValue(effectSpan, 'effect', diagnostics) : undefined;
      const lightSpan = gee ? positionalValue(values, 6) : undefined;
      const lightCode = gee ? itemNumericValue(
        lightSpan, 'light', diagnostics, value => Number.isInteger(value) && value >= 0
      ) : undefined;
      const unitSpan = gee ? positionalValue(values, 8) : undefined;
      const compactQuantity = gee ? itemBinaryValue(unitSpan, 'unit', diagnostics) : undefined;
      return withItemDiagnostics({
        mode: 'database-index',
        itemIndex,
        quantity,
        frameValue,
        ...(gray !== undefined ? { gray } : {}),
        ...(gom ? {
          ...(!alignSpan
            ? { align: 'natural' as const }
            : alignCustom === undefined
              ? {}
              : { align: alignCustom ? 'custom-width' as const : 'natural' as const }),
          ...(alignCustom === true
            ? { customWidth: customWidth ?? 40 }
            : {}),
          ...(!titleSpan ? { titleMode: false } : titleMode === undefined ? {} : { titleMode }),
          ...(!sourceSpan
            ? { imageSource: 'items' as const }
            : useStdItem === undefined
              ? {}
              : { imageSource: useStdItem ? 'std-item' as const : 'items' as const }),
          ...(!effectSpan ? { drawEffect: false } : drawEffect === undefined ? {} : { drawEffect }),
        } as const : {}),
        ...(gee ? {
          ...(!lightSpan ? { lightCode: 0 } : lightCode === undefined ? {} : { lightCode }),
          ...(!unitSpan
            ? { compactQuantity: false }
            : compactQuantity === undefined ? {} : { compactQuantity }),
        } : {}),
        label: itemIndex === undefined ? '动态物品 IDX' : `物品 IDX ${itemIndex}`,
      }, diagnostics);
    }
    case 'newui-itemshow-996pc': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const itemIdSpan = keyedValue(values, 'itemid');
      const itemNameSpan = keyedValue(values, 'itemname');
      const quantitySpan = keyedValue(values, 'itemcount');
      const colorSpan = keyedValue(values, 'color');
      const graySpan = keyedValue(values, 'grey');
      const lockSpan = keyedValue(values, 'lock');
      const backgroundSpan = keyedValue(values, 'bgtype');
      const scaleSpan = keyedValue(values, 'scale');
      const showTipsSpan = keyedValue(values, 'showtips');
      const itemIndex = itemNumericValue(
        itemIdSpan, 'itemid', diagnostics, value => Number.isInteger(value) && value >= 0
      );
      const itemName = itemTextValue(itemNameSpan, 'itemname', diagnostics);
      const quantity = itemNumericValue(
        quantitySpan, 'itemcount', diagnostics, value => Number.isInteger(value) && value >= 0
      );
      if (itemValueIsDynamic(colorSpan)) pushUniqueItemField(diagnostics.dynamicFields, 'color');
      const quantityColor = itemValueIsDynamic(colorSpan) ? undefined : statementValueColor(colorSpan);
      const gray = itemBinaryValue(graySpan, 'grey', diagnostics);
      const locked = itemBinaryValue(lockSpan, 'lock', diagnostics);
      const background = itemBinaryValue(backgroundSpan, 'bgtype', diagnostics);
      const scale = itemNumericValue(
        scaleSpan, 'scale', diagnostics, value => Number.isFinite(value) && value > 0
      );
      const showTips = itemBinaryValue(showTipsSpan, 'showtips', diagnostics);
      const preview = {
        ...(quantity !== undefined ? { quantity } : {}),
        ...(quantityColor ? { quantityColor } : {}),
        gray: gray ?? false,
        locked: locked ?? false,
        frameValue: background === true ? 1 : 0,
        ...(scale !== undefined ? { scale } : {}),
        ...(showTips !== undefined ? { showTips } : {}),
      };
      if (itemIndex !== undefined || !itemName) {
        return withItemDiagnostics({
          ...preview,
          mode: 'database-index',
          ...(itemIndex !== undefined ? { itemIndex } : {}),
          label: itemIndex === undefined ? '动态物品 IDX' : `物品 IDX ${itemIndex}`,
        }, diagnostics);
      }
      return withItemDiagnostics({
        ...preview,
        mode: 'database-name',
        itemName,
        label: `物品 ${itemName}`,
      }, diagnostics);
    }
    case 'newui-costitem-996pc': {
      const itemIndex = numericValue(keyedValue(values, 'itemid'));
      const itemName = cleanStaticValue(keyedValue(values, 'itemname'));
      const quantity = numericValue(keyedValue(values, 'itemcount'));
      if (itemIndex !== undefined || !itemName) {
        return {
          mode: 'database-index',
          itemIndex,
          quantity,
          frameValue: numericValue(keyedValue(values, 'bgtype')),
          label: itemIndex === undefined ? '动态物品 IDX' : `物品 IDX ${itemIndex}`,
        };
      }
      return {
        mode: 'database-name',
        itemName,
        quantity,
        frameValue: numericValue(keyedValue(values, 'bgtype')),
        label: `物品 ${itemName}`,
      };
    }
    case 'user-item-preview':
    case 'hero-user-item-preview': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const hero = schema.id === 'hero-user-item-preview';
      const slot = itemNumericValue(
        positionalValue(values, 1), 'index', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const frameValue = itemNumericValue(
        positionalValue(values, 4), 'bgtype', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const targetSpan = schema.engine === 'GOM' ? positionalValue(values, 5) : undefined;
      const viewedTarget = schema.engine === 'GOM'
        ? itemBinaryValue(targetSpan, 'target', diagnostics) : undefined;
      const graySpan = schema.engine === 'GOM' ? positionalValue(values, 6) : undefined;
      const gray = schema.engine === 'GOM'
        ? itemBinaryValue(graySpan, 'grey', diagnostics) : undefined;
      const alignSpan = schema.engine === 'GOM' ? positionalValue(values, 7) : undefined;
      const alignCustom = schema.engine === 'GOM'
        ? itemBinaryValue(alignSpan, 'align', diagnostics) : undefined;
      const customWidth = schema.engine === 'GOM' ? itemNumericValue(
        positionalValue(values, 8), 'customwidth', diagnostics,
        value => Number.isFinite(value) && value > 0
      ) : undefined;
      const sourceSpan = schema.engine === 'GOM' ? positionalValue(values, 9) : undefined;
      const useStdItem = schema.engine === 'GOM'
        ? itemBinaryValue(sourceSpan, 'source', diagnostics) : undefined;
      const effectSpan = schema.engine === 'GOM' ? positionalValue(values, 10) : undefined;
      const drawEffect = schema.engine === 'GOM'
        ? itemBinaryValue(effectSpan, 'effect', diagnostics) : undefined;
      const lightSpan = schema.engine !== 'GOM' ? positionalValue(values, 5) : undefined;
      const lightCode = schema.engine !== 'GOM' ? itemNumericValue(
        lightSpan, 'light', diagnostics, value => Number.isInteger(value) && value >= 0
      ) : undefined;
      return withItemDiagnostics({
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        frameValue,
        ...(schema.engine === 'GOM' ? {
          ...(!targetSpan
            ? { displayTarget: 'self' as const }
            : viewedTarget === undefined
              ? {}
              : { displayTarget: viewedTarget ? 'viewed-character' as const : 'self' as const }),
          ...(!graySpan ? { gray: false } : gray === undefined ? {} : { gray }),
          ...(!alignSpan
            ? { align: 'natural' as const }
            : alignCustom === undefined
              ? {}
              : { align: alignCustom ? 'custom-width' as const : 'natural' as const }),
          ...(alignCustom === true ? { customWidth: customWidth ?? 40 } : {}),
          ...(!sourceSpan
            ? { imageSource: 'items' as const }
            : useStdItem === undefined
              ? {}
              : { imageSource: useStdItem ? 'std-item' as const : 'items' as const }),
          ...(!effectSpan ? { drawEffect: false } : drawEffect === undefined ? {} : { drawEffect }),
        } as const : {
          ...(!lightSpan ? { lightCode: 0 } : lightCode === undefined ? {} : { lightCode }),
        }),
        label: `${hero ? '英雄' : '人物'}装备位 ${slot ?? '?'}`,
        message: '装备内容取决于游戏中的当前人物，只能静态预览物品框',
      }, diagnostics);
    }
    case 'newui-equipshow-996pc':
    case 'newui-heroequipshow-996pc': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const hero = schema.id === 'newui-heroequipshow-996pc';
      const slot = itemNumericValue(
        keyedValue(values, 'index'), 'index', diagnostics,
        value => Number.isInteger(value) && value >= 0 && value <= 55
      );
      const background = itemBinaryValue(keyedValue(values, 'bgtype'), 'bgtype', diagnostics);
      const scale = itemNumericValue(
        keyedValue(values, 'scale'), 'scale', diagnostics,
        value => Number.isFinite(value) && value > 0
      );
      const showTips = itemBinaryValue(keyedValue(values, 'showtips'), 'showtips', diagnostics);
      const showStar = itemBinaryValue(keyedValue(values, 'showstar'), 'showstar', diagnostics);
      const effectShow = itemNumericValue(
        keyedValue(values, 'effectshow'), 'effectshow', diagnostics,
        value => Number.isInteger(value) && value >= 0 && value <= 2
      ) as 0 | 1 | 2 | undefined;
      return withItemDiagnostics({
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        ...(background !== undefined ? { frameValue: background ? 1 : 0 } : {}),
        ...(scale !== undefined ? { scale } : {}),
        ...(showTips !== undefined ? { showTips } : {}),
        ...(showStar !== undefined ? { showStar } : {}),
        ...(effectShow !== undefined ? { effectShow } : {}),
        label: `${hero ? '英雄' : '人物'}装备位 ${slot ?? '?'}`,
        message: '装备内容取决于游戏中的当前人物，只能静态预览物品框',
      }, diagnostics);
    }
    case 'newui-dbitemshow-996pc':
    case 'newui-herodbitemshow-996pc': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const uniqueIndex = itemNumericValue(
        keyedValue(values, 'makeindex'), 'makeindex', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const background = itemBinaryValue(keyedValue(values, 'bgtype'), 'bgtype', diagnostics);
      const gray = itemBinaryValue(keyedValue(values, 'grey'), 'grey', diagnostics);
      const showStar = itemBinaryValue(keyedValue(values, 'showstar'), 'showstar', diagnostics);
      const showTips = itemBinaryValue(keyedValue(values, 'showtips'), 'showtips', diagnostics);
      return withItemDiagnostics({
        mode: 'unique-item',
        uniqueIndex,
        ...(background !== undefined ? { frameValue: background ? 1 : 0 } : {}),
        ...(gray !== undefined ? { gray } : {}),
        ...(showStar !== undefined ? { showStar } : {}),
        ...(showTips !== undefined ? { showTips } : {}),
        label: `唯一物品 ${uniqueIndex ?? '?'}`,
        message: '唯一物品由游戏运行时背包数据决定，只能静态预览物品框',
      }, diagnostics);
    }
    case 'makeindex-item-preview': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const uniqueIndex = itemNumericValue(
        positionalValue(values, 1), 'makeindex', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const quantity = itemNumericValue(
        positionalValue(values, 2), 'itemcount', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const frameValue = itemNumericValue(
        positionalValue(values, 5), 'bgtype', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const lightSpan = positionalValue(values, 6);
      const lightCode = itemNumericValue(
        lightSpan, 'light', diagnostics, value => Number.isInteger(value) && value >= 0
      );
      const graySpan = positionalValue(values, 7);
      const gray = itemBinaryValue(graySpan, 'grey', diagnostics);
      const unitSpan = positionalValue(values, 8);
      const compactQuantity = itemBinaryValue(unitSpan, 'unit', diagnostics);
      return withItemDiagnostics({
        mode: 'unique-item',
        uniqueIndex,
        quantity,
        frameValue,
        ...(!lightSpan ? { lightCode: 0 } : lightCode === undefined ? {} : { lightCode }),
        ...(!graySpan ? { gray: false } : gray === undefined ? {} : { gray }),
        ...(!unitSpan
          ? { compactQuantity: false }
          : compactQuantity === undefined ? {} : { compactQuantity }),
        label: `唯一物品 ${uniqueIndex ?? '?'}`,
        message: '唯一物品由游戏运行时数据决定，只能静态预览物品框',
      }, diagnostics);
    }
    case 'custom-item-preview':
    case 'hero-custom-item-preview': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const slot = itemNumericValue(
        positionalValue(values, 1), 'index', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const showInterior = itemBinaryValue(
        positionalValue(values, 6), 'interior', diagnostics
      );
      const hero = schema.id === 'hero-custom-item-preview';
      return withItemDiagnostics({
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        ...(showInterior !== undefined ? { showInterior } : {}),
        label: `${hero ? '英雄' : '人物'}自定义装备框 ${slot ?? '?'}`,
        message: 'Runtime-data blocked：装备内容取决于在线人物或英雄数据，当前只展示脚本指定的装备框底图',
      }, diagnostics);
    }
    case 'state-item-preview':
    case 'dnitems-preview': {
      const imageIndex = numericValue(positionalValue(values, 1));
      const archiveName = schema.id === 'state-item-preview' ? 'StateItem' : 'DnItems';
      return {
        mode: 'direct-archive',
        archiveName,
        imageIndex,
        frameValue: numericValue(positionalValue(values, 4)),
        label: `${archiveName} ${imageIndex ?? '?'}`,
      };
    }
    case 'item-box': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const boxIndex = itemNumericValue(
        positionalValue(values, 1), 'boxindex', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const backgroundSpan = positionalValue(values, 2);
      const backgroundValue = itemNumericValue(
        backgroundSpan, 'background', diagnostics,
        value => Number.isInteger(value) && value >= -1
      );
      let backgroundDisabled: boolean | undefined;
      if (backgroundValue !== undefined) backgroundDisabled = backgroundValue === -1;
      const constraints = itemBoxStdModeConstraint(positionalValue(values, 8), diagnostics);
      return withItemDiagnostics({
        mode: 'empty-box',
        ...(boxIndex !== undefined ? { boxIndex } : {}),
        ...constraints,
        ...(backgroundDisabled !== undefined ? { backgroundDisabled } : {}),
        label: `OK框 ${boxIndex ?? '?'}`,
        message: 'Runtime-data blocked：实际拖入物品、人物背包数据和服务器接受/拒绝结果无法离线模拟',
      }, diagnostics);
    }
    case 'newui-itembox-996pc': {
      const diagnostics: ItemPreviewDiagnostics = { dynamicFields: [], invalidFields: [] };
      const boxIndex = itemNumericValue(
        keyedValue(values, 'boxindex'), 'boxindex', diagnostics,
        value => Number.isInteger(value) && value >= 0
      );
      const constraints = itemBoxStdModeConstraint(keyedValue(values, 'stdmode'), diagnostics);
      const archiveSpan = keyedValue(values, 'wil');
      const imageSpan = keyedValue(values, 'pcimg');
      let backgroundDisabled: boolean | undefined;
      if (itemValueIsDynamic(archiveSpan) || itemValueIsDynamic(imageSpan)) {
        pushUniqueItemField(diagnostics.dynamicFields, 'background');
      } else if (archiveSpan || imageSpan) {
        const archiveName = cleanStaticValue(archiveSpan);
        const imageIndex = numericValue(imageSpan);
        if (archiveName && Number.isInteger(imageIndex) && imageIndex! >= 0) {
          backgroundDisabled = false;
        } else {
          pushUniqueItemField(diagnostics.invalidFields, 'background');
        }
      }
      return withItemDiagnostics({
        mode: 'empty-box',
        ...(boxIndex !== undefined ? { boxIndex } : {}),
        ...constraints,
        ...(backgroundDisabled !== undefined ? { backgroundDisabled } : {}),
        label: `OK框 ${boxIndex ?? '?'}`,
        message: 'Runtime-data blocked：实际拖入物品、人物背包数据和服务器接受/拒绝结果无法离线模拟',
      }, diagnostics);
    }
    case 'looks-preview': {
      const looks = numericValue(positionalValue(values, schema.engine === 'GEE' ? 1 : 2));
      const frameValue = numericValue(positionalValue(values, schema.engine === 'GEE' ? 4 : undefined));
      return {
        mode: 'looks',
        looks,
        frameValue,
        label: `物品 Looks ${looks ?? '?'}`,
      };
    }
    default:
      return undefined;
  }
}

function statementCostItemPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogCostItemPreview | undefined {
  if (schema.id !== 'newui-costitem-996pc') return undefined;
  const titleSpan = keyedValue(values, 'title');
  const staticTitle = cleanStaticValue(titleSpan);
  const displayedTitle = titleSpan ? displayParameterValue(titleSpan.raw) : '';
  const titleUsesClientDefault = !displayedTitle;
  const quantitySpan = keyedValue(values, 'itemcount');
  const staticQuantity = cleanStaticValue(quantitySpan);
  const scaleSpan = keyedValue(values, 'itemscale');
  const scaleValue = numericValue(scaleSpan);
  const fontSizeSpan = keyedValue(values, 'fontsize');
  const fontSizeValue = numericValue(fontSizeSpan);
  const itemScale = scaleValue !== undefined && scaleValue > 0 ? scaleValue : 1;
  const fontSize = fontSizeValue !== undefined && fontSizeValue > 0
    ? fontSizeValue
    : undefined;
  const dynamic = Boolean(
    (titleSpan && staticTitle === undefined && !titleUsesClientDefault)
    || (quantitySpan && staticQuantity === undefined)
    || (scaleSpan && scaleValue === undefined)
    || (fontSizeSpan && fontSizeValue === undefined)
  );
  return {
    title: titleUsesClientDefault
      ? '客户端默认标题'
      : staticTitle || displayedTitle,
    titleUsesClientDefault,
    ...(statementValueColor(keyedValue(values, 'titlecolor'))
      ? { titleColor: statementValueColor(keyedValue(values, 'titlecolor')) }
      : {}),
    quantityText: staticQuantity || (quantitySpan ? displayParameterValue(quantitySpan.raw) : '?'),
    ...(statementValueColor(keyedValue(values, 'color'))
      ? { quantityColor: statementValueColor(keyedValue(values, 'color')) }
      : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    itemScale,
    ...(dynamic ? { dynamic: true } : {}),
  };
}

function statementProgressPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogProgressPreview | undefined {
  type ProgressField = NonNullable<DialogProgressPreview['dynamicFields']>[number];
  let minimum: number | undefined;
  let maximum: number | undefined;
  let value: number | undefined;
  let direction: number | undefined;
  let offsetX = 0;
  let offsetY = 0;
  let text: string | undefined;
  let frameCount: number | undefined;
  let frameInterval: number | undefined;
  let endValue: number | undefined;
  let valueIntervalMs: number | undefined;
  let valueStep: number | undefined;
  let captionMode: DialogProgressPreview['captionMode'];
  let captionColor: string | undefined;
  let captionOffsetX = 0;
  let captionOffsetY = 0;
  let fontSize: number | undefined;
  let outlineWidth: number | undefined;
  let outlineColor: string | undefined;
  let showCaption: boolean | undefined;
  const defaultFields: ProgressField[] = [];
  const dynamicFields: NonNullable<DialogProgressPreview['dynamicFields']> = [];
  const invalidFields: NonNullable<DialogProgressPreview['invalidFields']> = [];
  const addField = (target: ProgressField[], field: ProgressField): void => {
    if (!target.includes(field)) target.push(field);
  };
  const strictNumber = (
    spanValue: ValueSpan | undefined,
    field: ProgressField,
    valid: (candidate: number) => boolean,
    fallback?: number,
    missing: 'default' | 'invalid' | 'ignore' = 'invalid'
  ): number | undefined => {
    if (!spanValue) {
      if (missing === 'default') addField(defaultFields, field);
      else if (missing === 'invalid') addField(invalidFields, field);
      return fallback;
    }
    if (/<\$/i.test(spanValue.raw)) {
      addField(dynamicFields, field);
      return undefined;
    }
    const parsed = numericValue(spanValue);
    if (parsed === undefined || !valid(parsed)) {
      addField(invalidFields, field);
      return undefined;
    }
    return parsed;
  };
  const strictResource = (
    spanValue: ValueSpan | undefined,
    field: 'archive' | 'background-image' | 'progress-image',
    archiveMode: 'will-index' | 'archive-name' = 'archive-name'
  ): void => {
    if (!spanValue) {
      addField(invalidFields, field);
      return;
    }
    if (/<\$/i.test(spanValue.raw)) {
      addField(dynamicFields, field);
      return;
    }
    if (field === 'archive') {
      if (archiveMode === 'will-index') {
        const numeric = numericValue(spanValue);
        if (!Number.isInteger(numeric) || numeric! < 0) addField(invalidFields, field);
      } else {
        const named = cleanStaticValue(spanValue)?.trim();
        if (!named || !/^[^\s|]+$/u.test(named)) addField(invalidFields, field);
      }
      return;
    }
    const numeric = numericValue(spanValue);
    if (numeric === undefined || !Number.isInteger(numeric) || numeric < 0) {
      addField(invalidFields, field);
    }
  };
  const strictColor = (
    spanValue: ValueSpan | undefined,
    field: 'caption-color' | 'outline-color'
  ): string | undefined => {
    if (!spanValue) return undefined;
    if (/<\$/i.test(spanValue.raw)) {
      addField(dynamicFields, field);
      return undefined;
    }
    const cleaned = cleanStaticValue(spanValue)?.trim();
    const numeric = numericValue(spanValue);
    const valid = Boolean(cleaned && /^[$#][0-9A-F]{6}$/i.test(cleaned))
      || (Number.isInteger(numeric) && numeric! >= 0 && numeric! <= 255);
    if (!valid) {
      addField(invalidFields, field);
      return undefined;
    }
    return statementValueColor(spanValue);
  };

  if (isLegacyProgressBarSchema(schema)) {
    const archiveSpan = positionalValue(values, 3);
    const backgroundSpan = positionalValue(values, 4);
    const progressSpan = positionalValue(values, 5);
    const minimumSpan = positionalValue(values, 10);
    const maximumSpan = positionalValue(values, 11);
    const valueSpan = positionalValue(values, 12);
    const directionSpan = positionalValue(values, 13);
    const frameCountSpan = positionalValue(values, 6);
    const frameIntervalSpan = positionalValue(values, 7);
    const captionColorSpan = positionalValue(values, 14);
    const captionOffsetXSpan = positionalValue(values, 15);
    const captionOffsetYSpan = positionalValue(values, 16);
    const textSpan = positionalValue(values, 17);
    strictResource(archiveSpan, 'archive', 'will-index');
    strictResource(backgroundSpan, 'background-image');
    strictResource(progressSpan, 'progress-image');
    minimum = strictNumber(minimumSpan, 'minimum', Number.isFinite, 0, 'default');
    maximum = strictNumber(maximumSpan, 'maximum', Number.isFinite, 100, 'default');
    value = strictNumber(valueSpan, 'value', Number.isFinite, minimum, 'default');
    direction = strictNumber(
      directionSpan, 'direction', candidate => Number.isInteger(candidate) && candidate >= 0 && candidate <= 3,
      0, 'default'
    );
    const parsedFrameCount = strictNumber(
      frameCountSpan, 'frame-count', candidate => Number.isInteger(candidate) && candidate >= 0
    );
    frameCount = parsedFrameCount && parsedFrameCount > 0 ? parsedFrameCount : undefined;
    frameInterval = strictNumber(
      frameIntervalSpan, 'frame-interval', candidate => candidate >= 0
    );
    offsetX = strictNumber(
      positionalValue(values, 8), 'offset-x', Number.isFinite, 0, 'default'
    ) ?? 0;
    offsetY = strictNumber(
      positionalValue(values, 9), 'offset-y', Number.isFinite, 0, 'default'
    ) ?? 0;
    captionOffsetX = strictNumber(
      captionOffsetXSpan, 'caption-offset-x', Number.isFinite, 0, 'default'
    ) ?? 0;
    captionOffsetY = strictNumber(
      captionOffsetYSpan, 'caption-offset-y', Number.isFinite, 0, 'default'
    ) ?? 0;
    captionColor = strictColor(captionColorSpan, 'caption-color');
    if (!textSpan) {
      text = '%p/%m';
      addField(defaultFields, 'text');
    } else if (/<\$/i.test(textSpan.raw)) addField(dynamicFields, 'text');
    else {
      text = cleanStaticValue(textSpan);
      if (text === undefined) addField(invalidFields, 'text');
    }
    if (
      minimum !== undefined && maximum !== undefined && value !== undefined
      && (maximum <= minimum || value < minimum || value > maximum)
    ) {
      addField(invalidFields, 'minimum');
      addField(invalidFields, 'maximum');
      addField(invalidFields, 'value');
      minimum = undefined;
      maximum = undefined;
      value = undefined;
    }
  } else if (schema.id === 'newui-loadingbar-996pc') {
    const archiveSpan = keyedValue(values, 'wil');
    const backgroundSpan = keyedValue(values, 'pcloadingbg');
    const progressSpan = keyedValue(values, 'pcloadingbar');
    const maximumSpan = keyedValue(values, 'maxper');
    const valueSpan = keyedValue(values, 'startper');
    const directionSpan = keyedValue(values, 'direction');
    const offsetXSpan = keyedValue(values, 'offsetx');
    const offsetYSpan = keyedValue(values, 'offsety');
    const endValueSpan = keyedValue(values, 'endper');
    const valueIntervalSpan = keyedValue(values, 'interval');
    const valueStepSpan = keyedValue(values, 'loadvalue');
    const visibilitySpan = keyedValue(values, 'hidetext');
    const fontSizeSpan = keyedValue(values, 'size');
    const captionColorSpan = keyedValue(values, 'color');
    const outlineWidthSpan = keyedValue(values, 'outline');
    const outlineColorSpan = keyedValue(values, 'outlinecolor');
    strictResource(archiveSpan, 'archive');
    strictResource(backgroundSpan, 'background-image');
    strictResource(progressSpan, 'progress-image');
    minimum = 0;
    maximum = strictNumber(maximumSpan, 'maximum', candidate => candidate > 0, 100, 'default');
    value = strictNumber(valueSpan, 'value', candidate => candidate >= 0, 0, 'default');
    direction = strictNumber(
      directionSpan, 'direction', candidate => Number.isInteger(candidate) && candidate >= 0 && candidate <= 1,
      0, 'default'
    );
    offsetX = strictNumber(offsetXSpan, 'offset-x', Number.isFinite, 0, 'default') ?? 0;
    offsetY = strictNumber(offsetYSpan, 'offset-y', Number.isFinite, 0, 'default') ?? 0;
    text = '';
    endValue = strictNumber(endValueSpan, 'end-value', candidate => candidate >= 0, 100, 'default');
    const intervalSeconds = strictNumber(
      valueIntervalSpan, 'value-interval', candidate => candidate > 0, .05, 'default'
    );
    valueIntervalMs = intervalSeconds === undefined ? undefined : intervalSeconds * 1000;
    valueStep = strictNumber(valueStepSpan, 'value-step', candidate => candidate > 0, 10, 'default');
    captionMode = 'percent';
    const visibility = strictNumber(
      visibilitySpan, 'visibility', candidate => candidate === 0 || candidate === 1,
      0, 'default'
    );
    showCaption = visibility === undefined ? undefined : visibility === 0;
    fontSize = strictNumber(fontSizeSpan, 'font-size', candidate => candidate > 0, undefined, 'ignore');
    outlineWidth = strictNumber(
      outlineWidthSpan, 'outline-width', candidate => candidate >= 0, undefined, 'ignore'
    );
    captionColor = strictColor(captionColorSpan, 'caption-color');
    outlineColor = strictColor(outlineColorSpan, 'outline-color');
    const invalidRange = invalidFields.includes('maximum')
      || (minimum !== undefined && value !== undefined && maximum !== undefined
        && (value < minimum || value > maximum))
      || (endValue !== undefined && maximum !== undefined
        && (endValue < (minimum ?? 0) || endValue > maximum))
      || (value !== undefined && endValue !== undefined && value > endValue);
    if (invalidRange) {
      addField(invalidFields, 'maximum');
      addField(invalidFields, 'value');
      addField(invalidFields, 'end-value');
      maximum = undefined;
      value = undefined;
      endValue = undefined;
    }
  } else if (schema.id === 'newui-slider-996pc') {
    const slider = statementSliderPreview(values, schema)!;
    minimum = 0;
    maximum = slider.maximum;
    value = slider.initialValue;
    direction = 0;
    text = '';
    for (const field of slider.defaultFields || []) addField(defaultFields, field);
    for (const field of slider.dynamicFields || []) {
      if ((['archive', 'background-image', 'progress-image', 'thumb-image', 'maximum', 'value'] as string[])
        .includes(field)) addField(dynamicFields, field as ProgressField);
    }
    for (const field of slider.invalidFields || []) {
      if ((['archive', 'background-image', 'progress-image', 'thumb-image', 'maximum', 'value'] as string[])
        .includes(field)) addField(invalidFields, field as ProgressField);
    }
    showCaption = false;
  } else if (schema.id === 'newui-percentimg-996pc') {
    const archiveSpan = keyedValue(values, 'wil');
    const imageSpan = keyedValue(values, 'pcimg');
    const maximumSpan = keyedValue(values, 'maxvalue');
    const valueSpan = keyedValue(values, 'minvalue');
    const directionSpan = keyedValue(values, 'direction');
    strictResource(archiveSpan, 'archive');
    strictResource(imageSpan, 'progress-image');
    minimum = 0;
    maximum = strictNumber(maximumSpan, 'maximum', candidate => candidate > 0, 100, 'default');
    value = strictNumber(valueSpan, 'value', candidate => candidate >= 0, 0, 'default');
    direction = strictNumber(
      directionSpan, 'direction', candidate => Number.isInteger(candidate) && candidate >= 0 && candidate <= 3,
      0, 'default'
    );
    text = '';
    if (invalidFields.includes('maximum') && value !== undefined) {
      addField(invalidFields, 'value');
      value = undefined;
    }
    if (
      maximum !== undefined && value !== undefined
      && (value < minimum || value > maximum)
    ) {
      addField(invalidFields, 'maximum');
      addField(invalidFields, 'value');
      maximum = undefined;
      value = undefined;
    }
    showCaption = false;
  } else {
    return undefined;
  }

  const denominator = minimum !== undefined && maximum !== undefined
    ? maximum - minimum
    : undefined;
  const ratio = denominator !== undefined && denominator > 0 && value !== undefined
    ? (value - minimum!) / denominator
    : undefined;
  return {
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(ratio !== undefined ? { ratio } : {}),
    ...(direction !== undefined ? { direction } : {}),
    offsetX,
    offsetY,
    ...(text !== undefined ? { text } : {}),
    ...(frameCount !== undefined ? { frameCount } : {}),
    ...(frameInterval !== undefined ? { frameInterval } : {}),
    ...(endValue !== undefined ? { endValue } : {}),
    ...(valueIntervalMs !== undefined ? { valueIntervalMs } : {}),
    ...(valueStep !== undefined ? { valueStep } : {}),
    ...(captionMode ? { captionMode } : {}),
    ...(captionColor ? { captionColor } : {}),
    captionOffsetX,
    captionOffsetY,
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(outlineWidth !== undefined ? { outlineWidth } : {}),
    ...(outlineColor ? { outlineColor } : {}),
    ...(defaultFields.length > 0 ? { defaultFields } : {}),
    ...(dynamicFields.length > 0 ? { dynamicFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    ...(showCaption !== undefined
      ? { showCaption }
      : ['newui-slider-996pc', 'newui-percentimg-996pc'].includes(schema.id)
        ? { showCaption: false }
        : {}),
  };
}

function progressAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetReference | undefined {
  const legacyProgress = isLegacyProgressBarSchema(schema);
  const image = legacyProgress
    ? positionalValue(values, 5)
    : schema.id === 'newui-loadingbar-996pc'
      ? keyedValue(values, 'pcloadingbar')
      : schema.id === 'newui-slider-996pc'
        ? keyedValue(values, 'pcbarimg')
      : undefined;
  const archive = legacyProgress
    ? positionalValue(values, 3)
    : keyedValue(values, 'wil');
  const reference = strictStaticAssetReference(
    archive,
    image,
    legacyProgress ? 'will-index' : 'archive-name'
  );
  if (reference && legacyProgress) {
    const count = numericValue(positionalValue(values, 6));
    if (Number.isInteger(count) && count! > 0) reference.frameCount = count;
  }
  return reference;
}

function isLegacyProgressBarSchema(schema: DialogStatementSchema): boolean {
  return /^progress-bar(?:-relative-compat)?$/i.test(schema.id);
}

function sliderThumbAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetReference | undefined {
  if (schema.id !== 'newui-slider-996pc') return undefined;
  return strictStaticAssetReference(
    keyedValue(values, 'wil'),
    keyedValue(values, 'pcballimg'),
    'archive-name'
  );
}

function statementContainerPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogContainerPreview | undefined {
  const id = schema.id.toLowerCase();
  if (/newui-(?:hero)?(?:bagitems|equipitems)-996pc/.test(id)) {
    const hero = id.includes('hero');
    const equipment = id.includes('equipitems');
    const gridSource: DialogItemGridSource = equipment
      ? hero ? 'hero-equipment' : 'character-equipment'
      : hero ? 'hero-bag' : 'character-bag';
    const defaultFields: DialogItemGridField[] = [];
    const dynamicFields: DialogItemGridField[] = [];
    const invalidFields: DialogItemGridField[] = [];
    const diagnostics = { defaultFields, dynamicFields, invalidFields };
    const filterCondition = !equipment
      ? itemGridTextValue(values, 'condition', 'condition', diagnostics)
      : undefined;
    const equipmentPositions = equipment
      ? itemGridTextValue(values, 'positions', 'positions', diagnostics)
      : undefined;
    const selectedUniqueIds = itemGridListValue(values, 'select', 'select', diagnostics);
    const cellCount = itemGridPositiveInteger(
      values, 'count', 'count', 12, diagnostics
    );
    const rows = itemGridPositiveInteger(values, 'row', 'row', 4, diagnostics);
    const cellWidth = itemGridCellDimension(
      keyedValue(values, 'iwidth'),
      'iwidth',
      diagnostics
    );
    const cellHeight = itemGridCellDimension(
      keyedValue(values, 'iheight'),
      'iheight',
      diagnostics
    );
    const selectionType = itemGridBinaryNumber(
      values, 'selecttype', 'selecttype', diagnostics
    );
    const showStarValue = itemGridBinaryNumber(values, 'showstar', 'showstar', diagnostics);
    const filterStarValue = !equipment ? itemGridBinaryNumber(
      values, 'conditionEx', 'conditionEx', diagnostics, true
    ) : undefined;
    const starLevel = !equipment ? itemGridNonNegativeInteger(
      values, 'conditionParam', 'conditionParam', diagnostics, true
    ) : undefined;
    const starConditionValue = !equipment ? itemGridBinaryNumber(
      values, 'conditionOnOff', 'conditionOnOff', diagnostics, true
    ) : undefined;
    const excludedUniqueIds = !equipment
      ? itemGridListValue(values, 'exclude', 'exclude', diagnostics)
      : undefined;
    const excludedItemIds = !equipment
      ? itemGridListValue(values, 'filter1', 'filter1', diagnostics)
      : undefined;
    const excludedItemNames = !equipment
      ? itemGridListValue(values, 'filter2', 'filter2', diagnostics)
      : undefined;
    const includedItemRefs = !equipment
      ? itemGridListValue(values, 'filter3', 'filter3', diagnostics)
      : undefined;
    const excludeBoundValue = !equipment
      ? itemGridBinaryNumber(values, 'exbind', 'exbind', diagnostics)
      : undefined;
    const showTipsValue = itemGridBinaryNumber(values, 'showtips', 'showtips', diagnostics);
    return {
      variant: 'item-grid',
      label: equipment
        ? `${hero ? '英雄' : '人物'}装备物品列表`
        : `${hero ? '英雄' : '人物'}背包物品列表`,
      gridSource,
      ...(filterCondition !== undefined ? { filterCondition } : {}),
      ...(equipmentPositions !== undefined ? { equipmentPositions } : {}),
      ...(selectedUniqueIds !== undefined ? { selectedUniqueIds } : {}),
      ...(selectionType !== undefined
        ? { selectionMode: selectionType === 1 ? 'single' as const : 'multi' as const }
        : {}),
      ...(showTipsValue !== undefined ? { showTips: showTipsValue === 1 } : {}),
      ...(showStarValue !== undefined ? { showStar: showStarValue === 1 } : {}),
      ...(filterStarValue !== undefined ? { filterStar: filterStarValue === 1 } : {}),
      ...(starLevel !== undefined ? { starLevel } : {}),
      ...(starConditionValue !== undefined
        ? { starCondition: starConditionValue as 0 | 1 }
        : {}),
      ...(excludedUniqueIds !== undefined ? { excludedUniqueIds } : {}),
      ...(excludedItemIds !== undefined ? { excludedItemIds } : {}),
      ...(excludedItemNames !== undefined ? { excludedItemNames } : {}),
      ...(includedItemRefs !== undefined ? { includedItemRefs } : {}),
      ...(excludeBoundValue !== undefined ? { excludeBound: excludeBoundValue === 1 } : {}),
      cellCount,
      rows,
      columns: Math.max(1, Math.ceil(cellCount / rows)),
      cellWidth,
      cellHeight,
      cellGap: ITEM_GRID_PREVIEW_GAP,
      ...(defaultFields.length > 0 ? { defaultFields } : {}),
      ...(dynamicFields.length > 0 ? { dynamic: true, dynamicFields } : {}),
      ...(invalidFields.length > 0 ? { invalidFields } : {}),
    };
  }
  if (!/(?:layout|listview|container-newline)/.test(id)) return undefined;
  if (id.includes('newline')) {
    return { variant: 'line-break', label: '容器换行' };
  }
  const isList = id.includes('listview');
  if (isList) {
    return statementListViewPreview(values, schema);
  }
  const colorValue = schema.syntax === 'key-value'
    ? cleanStaticValue(keyedValue(values, 'color'))
    : cleanStaticValue(positionalValue(values, 6));
  const colorNumber = colorValue === undefined ? undefined : Number(colorValue);
  const color = Number.isInteger(colorNumber) && colorNumber! >= 0
    ? legendColor(colorNumber!)
    : undefined;
  return {
    variant: 'layout',
    label: '布局容器',
    ...(color
      ? schema.id === 'newui-layout-996pc'
        ? { fillColor: color }
        : { borderColor: color }
      : {}),
  };
}

interface ListViewDiagnostics {
  defaultFields: DialogListViewField[];
  dynamicFields: DialogListViewField[];
  invalidFields: DialogListViewField[];
  fieldDiagnostics: DialogListViewFieldDiagnostic[];
}

const LIST_SCROLLBAR_SLOTS = [
  { role: 'scrollbar', legacyParameter: 13, key: 'Sdbg' },
  { role: 'scroll-start', legacyParameter: 14, key: 'Sdupnimg' },
  { role: 'scroll-start-hover', legacyParameter: 15, key: 'Sdupmimg' },
  { role: 'scroll-start-pressed', legacyParameter: 16, key: 'Sduppimg' },
  { role: 'scroll-thumb', legacyParameter: 17, key: 'Sdnimg' },
  { role: 'scroll-thumb-hover', legacyParameter: 18, key: 'Sdmimg' },
  { role: 'scroll-thumb-pressed', legacyParameter: 19, key: 'Sdpimg' },
  { role: 'scroll-end', legacyParameter: 20, key: 'Sddwnimg' },
  { role: 'scroll-end-hover', legacyParameter: 21, key: 'Sddwmimg' },
  { role: 'scroll-end-pressed', legacyParameter: 22, key: 'Sddwpimg' },
] as const;

function pushListField(fields: DialogListViewField[], field: DialogListViewField): void {
  if (!fields.includes(field)) fields.push(field);
}

function listValueMissing(value: ValueSpan | undefined): boolean {
  return !value || stripValueSuffix(value.raw).trim().length === 0;
}

function addListFieldDiagnostic(
  diagnostics: ListViewDiagnostics,
  field: DialogListViewField,
  value: ValueSpan | undefined,
  sourceStatus: DialogListViewFieldDiagnostic['sourceStatus'],
  message?: string
): void {
  diagnostics.fieldDiagnostics.push({
    field,
    sourceStatus,
    status: sourceStatus,
    ...(value ? { rawSource: value.raw } : {}),
    ...(message ? { message } : {}),
  });
  if (sourceStatus === 'default') pushListField(diagnostics.defaultFields, field);
  else if (sourceStatus === 'dynamic') pushListField(diagnostics.dynamicFields, field);
  else if (sourceStatus === 'invalid') pushListField(diagnostics.invalidFields, field);
}

function listNumericField(
  diagnostics: ListViewDiagnostics,
  field: DialogListViewField,
  value: ValueSpan | undefined,
  options: {
    fallback?: number;
    integer?: boolean;
    minimum?: number;
    allowed?: readonly number[];
  } = {}
): number | undefined {
  if (listValueMissing(value)) {
    addListFieldDiagnostic(diagnostics, field, value, 'default');
    return options.fallback;
  }
  if (/<\$/i.test(value!.raw)) {
    addListFieldDiagnostic(
      diagnostics,
      field,
      value,
      'dynamic',
      '动态源码保持未知，不借用 MOV 当前值'
    );
    return undefined;
  }
  const parsed = numericValue(value);
  const valid = parsed !== undefined
    && Number.isFinite(parsed)
    && (!options.integer || Number.isInteger(parsed))
    && (options.minimum === undefined || parsed >= options.minimum)
    && (!options.allowed || options.allowed.includes(parsed));
  if (!valid) {
    addListFieldDiagnostic(diagnostics, field, value, 'invalid');
    return undefined;
  }
  addListFieldDiagnostic(diagnostics, field, value, 'static');
  return parsed;
}

function addReservedListField(
  diagnostics: ListViewDiagnostics,
  field: DialogListViewField,
  value: ValueSpan | undefined
): void {
  addListFieldDiagnostic(
    diagnostics,
    field,
    value,
    'reserved',
    '当前引擎帮助将该参数标为预留；仅保留源码，不解释运行时语义'
  );
}

function statementListViewPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogContainerPreview {
  const keyed = schema.syntax === 'key-value';
  const diagnostics: ListViewDiagnostics = {
    defaultFields: [],
    dynamicFields: [],
    invalidFields: [],
    fieldDiagnostics: [],
  };
  const gapField: DialogListViewField = keyed ? 'margin' : 'gap';
  const gapSpan = keyed ? keyedValue(values, 'margin') : positionalValue(values, 6);
  const gap = listNumericField(diagnostics, gapField, gapSpan, { fallback: 0 });
  const defaultSpan = keyed ? keyedValue(values, 'default') : positionalValue(values, 7);
  const requestedDefaultIndex = listNumericField(
    diagnostics,
    'default',
    defaultSpan,
    { integer: true, minimum: keyed ? 1 : 0 }
  );
  const directionSpan = keyed ? keyedValue(values, 'direction') : positionalValue(values, 8);
  const directionValue = listNumericField(
    diagnostics,
    'direction',
    directionSpan,
    { fallback: keyed ? 1 : 0, integer: true, allowed: keyed ? [1, 2] : [0, 1] }
  );
  const direction = directionValue === undefined
    ? undefined
    : keyed
      ? directionValue === 2 ? 'horizontal' as const : 'vertical' as const
      : directionValue === 1 ? 'horizontal' as const : 'vertical' as const;
  const effectiveDefaultIndex = requestedDefaultIndex === undefined
    ? 0
    : Math.max(0, keyed ? requestedDefaultIndex - 1 : requestedDefaultIndex);

  let rememberScrollPosition: boolean | undefined;
  let touchEnabled: boolean | undefined;
  let bounce: number | undefined;
  let sliderValue: number | undefined;
  if (keyed) {
    const touchValue = listNumericField(
      diagnostics,
      'cantouch',
      keyedValue(values, 'cantouch'),
      { fallback: 1, integer: true, allowed: [0, 1] }
    );
    touchEnabled = touchValue === undefined ? undefined : touchValue === 1;
    bounce = listNumericField(diagnostics, 'bounce', keyedValue(values, 'bounce'));
    sliderValue = listNumericField(
      diagnostics,
      'slider',
      keyedValue(values, 'Slider'),
      { fallback: 0, integer: true, allowed: [0, 1] }
    );
  } else if (schema.engine === 'GOM') {
    const rememberValue = listNumericField(
      diagnostics,
      'remember-scroll-position',
      positionalValue(values, 9),
      { fallback: 0, integer: true, allowed: [0, 1] }
    );
    rememberScrollPosition = rememberValue === undefined ? undefined : rememberValue === 1;
    addReservedListField(diagnostics, 'reserved-4', positionalValue(values, 10));
    addReservedListField(diagnostics, 'reserved-5', positionalValue(values, 11));
  } else {
    addReservedListField(diagnostics, 'reserved-3', positionalValue(values, 9));
    addReservedListField(diagnostics, 'reserved-4', positionalValue(values, 10));
    addReservedListField(diagnostics, 'reserved-5', positionalValue(values, 11));
  }

  const scrollbar = buildListScrollbarDiagnostics(values, schema, sliderValue, diagnostics);
  const reservedFields = diagnostics.fieldDiagnostics
    .filter(value => value.sourceStatus === 'reserved')
    .map(value => value.field);
  const interactionStatus: NonNullable<DialogContainerPreview['interactionStatus']> =
    diagnostics.invalidFields.length > 0
      ? 'blocked-invalid'
      : diagnostics.dynamicFields.length > 0
        ? 'blocked-dynamic'
        : touchEnabled === false
          ? 'disabled'
          : 'local-only';
  return {
    variant: 'list',
    label: '列表容器',
    ...(direction ? { direction } : {}),
    ...(gap !== undefined ? { gap } : {}),
    ...(requestedDefaultIndex !== undefined ? { requestedDefaultIndex } : {}),
    effectiveDefaultIndex,
    defaultIndex: effectiveDefaultIndex,
    ...(rememberScrollPosition !== undefined ? { rememberScrollPosition } : {}),
    localOnly: true,
    interactionStatus,
    ...(reservedFields.length > 0 ? { reservedFields } : {}),
    viewportClipped: true,
    ...(keyed ? {
      ...(touchEnabled !== undefined ? { touchEnabled } : {}),
      ...(bounce !== undefined ? { bounce } : {}),
    } : {}),
    ...(scrollbar.mode ? { scrollbarMode: scrollbar.mode } : {}),
    scrollbarDiagnostics: scrollbar.diagnostics,
    fieldDiagnostics: diagnostics.fieldDiagnostics,
    ...(diagnostics.defaultFields.length > 0 ? { defaultFields: diagnostics.defaultFields } : {}),
    ...(diagnostics.dynamicFields.length > 0
      ? { dynamic: true, dynamicFields: diagnostics.dynamicFields }
      : {}),
    ...(diagnostics.invalidFields.length > 0
      ? { dynamic: true, invalidFields: diagnostics.invalidFields }
      : {}),
    ...(scrollbar.diagnostics.some(value => value.sourceStatus === 'dynamic')
      ? { scrollbarDynamic: true }
      : {}),
  };
}

function buildListScrollbarDiagnostics(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  sliderValue: number | undefined,
  fieldDiagnostics: ListViewDiagnostics
): {
  mode: DialogContainerPreview['scrollbarMode'];
  diagnostics: DialogListViewScrollbarDiagnostic[];
} {
  if (schema.id === 'newui-listview-996pc') {
    const sliderStatus = fieldDiagnostics.fieldDiagnostics.find(value => value.field === 'slider')
      ?.sourceStatus;
    if (sliderStatus === 'dynamic' || sliderStatus === 'invalid') {
      return {
        mode: sliderStatus === 'dynamic'
          && fieldDiagnostics.dynamicFields.some(field => field !== 'slider')
          ? undefined
          : 'blocked',
        diagnostics: LIST_SCROLLBAR_SLOTS.map(slot => ({
          field: slot.key,
          role: slot.role,
          sourceStatus: sliderStatus,
          status: sliderStatus,
          message: 'Slider 状态无法静态确定，已阻止全部滚动条素材请求',
        })),
      };
    }
    if (sliderValue !== 1) {
      return {
        mode: 'disabled',
        diagnostics: LIST_SCROLLBAR_SLOTS.map(slot => ({
          field: slot.key,
          role: slot.role,
          sourceStatus: 'disabled',
          status: 'disabled',
          message: 'Slider 未启用；即使残留图片参数也不请求素材',
        })),
      };
    }
    const hasExplicitSlot = LIST_SCROLLBAR_SLOTS.some(slot => (
      !listValueMissing(keyedValue(values, slot.key))
    ));
    if (!hasExplicitSlot) {
      return {
        mode: 'client-default',
        diagnostics: LIST_SCROLLBAR_SLOTS.map(slot => ({
          field: slot.key,
          role: slot.role,
          sourceStatus: 'default',
          status: 'default',
          message: 'Slider=1 且未指定自定义图片；客户端默认素材映射未公开',
        })),
      };
    }
    const diagnostics = LIST_SCROLLBAR_SLOTS.map(slot => listScrollbarSlotDiagnostic(
      slot.key,
      slot.role,
      keyedValue(values, slot.key),
      imageIndex => ({ archiveRole: 'game-ui-pack', imageIndex })
    ));
    return {
      mode: diagnostics.some(value => value.sourceStatus === 'static') ? 'custom' : 'blocked',
      diagnostics,
    };
  }

  const archive = positionalValue(values, 12);
  const hasAnySource = !listValueMissing(archive) || LIST_SCROLLBAR_SLOTS.some(slot => (
    !listValueMissing(positionalValue(values, slot.legacyParameter))
  ));
  if (!hasAnySource) {
    return {
      mode: 'disabled',
      diagnostics: LIST_SCROLLBAR_SLOTS.map(slot => ({
        field: `parameter-${slot.legacyParameter}`,
        role: slot.role,
        sourceStatus: 'disabled',
        status: 'disabled',
      })),
    };
  }
  let archiveStatus: 'static' | 'dynamic' | 'invalid' | 'missing';
  let willIndex: number | undefined;
  if (listValueMissing(archive)) archiveStatus = 'missing';
  else if (/<\$/i.test(archive!.raw)) archiveStatus = 'dynamic';
  else {
    const parsed = numericValue(archive);
    if (Number.isSafeInteger(parsed) && parsed! >= 0) {
      archiveStatus = 'static';
      willIndex = parsed;
    } else archiveStatus = 'invalid';
  }
  const diagnostics = LIST_SCROLLBAR_SLOTS.map(slot => {
    const image = positionalValue(values, slot.legacyParameter);
    if (archiveStatus !== 'static' || willIndex === undefined) {
      return {
        field: `parameter-${slot.legacyParameter}`,
        role: slot.role,
        sourceStatus: archiveStatus,
        status: archiveStatus,
        ...(image ? { rawSource: image.raw } : {}),
        message: '滚动条 WIL/WZL 序号无法静态确定，已阻止素材请求',
      } satisfies DialogListViewScrollbarDiagnostic;
    }
    return listScrollbarSlotDiagnostic(
      `parameter-${slot.legacyParameter}`,
      slot.role,
      image,
      imageIndex => ({ willIndex, imageIndex })
    );
  });
  return {
    mode: diagnostics.some(value => value.sourceStatus === 'static') ? 'custom' : 'blocked',
    diagnostics,
  };
}

function listScrollbarSlotDiagnostic(
  field: string,
  role: DialogListViewScrollbarDiagnostic['role'],
  value: ValueSpan | undefined,
  reference: (imageIndex: number) => DialogAssetReference
): DialogListViewScrollbarDiagnostic {
  if (listValueMissing(value)) {
    return { field, role, sourceStatus: 'missing', status: 'missing' };
  }
  if (/<\$/i.test(value!.raw)) {
    return {
      field,
      role,
      sourceStatus: 'dynamic',
      status: 'dynamic',
      rawSource: value!.raw,
      message: '动态图片序号不借用 MOV 当前值',
    };
  }
  const imageIndex = numericValue(value);
  if (!Number.isSafeInteger(imageIndex) || imageIndex! < 0) {
    return {
      field,
      role,
      sourceStatus: 'invalid',
      status: 'invalid',
      rawSource: value!.raw,
    };
  }
  return {
    field,
    role,
    sourceStatus: 'static',
    status: 'static',
    rawSource: value!.raw,
    assetRef: reference(imageIndex!),
  };
}

interface ItemGridDiagnostics {
  defaultFields: DialogItemGridField[];
  dynamicFields: DialogItemGridField[];
  invalidFields: DialogItemGridField[];
}

function pushUniqueGridField(fields: DialogItemGridField[], field: DialogItemGridField): void {
  if (!fields.includes(field)) fields.push(field);
}

function itemGridStaticSpan(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  diagnostics: ItemGridDiagnostics,
  exactCase = false
): ValueSpan | undefined {
  const value = keyedValue(values, key);
  if (!value) return undefined;
  if (exactCase && values.keyNames.get(key.toLowerCase()) !== key) {
    pushUniqueGridField(diagnostics.invalidFields, field);
    return undefined;
  }
  if (/<\$/i.test(value.raw)) {
    pushUniqueGridField(diagnostics.dynamicFields, field);
    return undefined;
  }
  return value;
}

function itemGridTextValue(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  diagnostics: ItemGridDiagnostics,
  exactCase = false
): string | undefined {
  const value = itemGridStaticSpan(values, key, field, diagnostics, exactCase);
  if (!value) return undefined;
  const parsed = cleanStaticValue(value);
  if (parsed === undefined) pushUniqueGridField(diagnostics.invalidFields, field);
  return parsed;
}

function itemGridListValue(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  diagnostics: ItemGridDiagnostics
): string[] | undefined {
  const parsed = itemGridTextValue(values, key, field, diagnostics);
  if (parsed === undefined) return undefined;
  const items = parsed.split(',').map(item => item.trim()).filter(Boolean);
  if (items.length === 0) {
    pushUniqueGridField(diagnostics.invalidFields, field);
    return undefined;
  }
  return items;
}

function itemGridPositiveInteger(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  fallback: number,
  diagnostics: ItemGridDiagnostics
): number {
  const raw = keyedValue(values, key);
  if (!raw) {
    pushUniqueGridField(diagnostics.defaultFields, field);
    return fallback;
  }
  const value = itemGridStaticSpan(values, key, field, diagnostics);
  if (!value) return fallback;
  const parsed = numericValue(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    pushUniqueGridField(diagnostics.invalidFields, field);
    return fallback;
  }
  return parsed;
}

function itemGridNonNegativeInteger(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  diagnostics: ItemGridDiagnostics,
  exactCase = false
): number | undefined {
  const value = itemGridStaticSpan(values, key, field, diagnostics, exactCase);
  if (!value) return undefined;
  const parsed = numericValue(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    pushUniqueGridField(diagnostics.invalidFields, field);
    return undefined;
  }
  return parsed;
}

function itemGridBinaryNumber(
  values: ParsedStatementValues,
  key: string,
  field: DialogItemGridField,
  diagnostics: ItemGridDiagnostics,
  exactCase = false
): 0 | 1 | undefined {
  const value = itemGridStaticSpan(values, key, field, diagnostics, exactCase);
  if (!value) return undefined;
  const parsed = numericValue(value);
  if (parsed !== 0 && parsed !== 1) {
    pushUniqueGridField(diagnostics.invalidFields, field);
    return undefined;
  }
  return parsed;
}

function itemGridBoundaryWarnings(
  preview: DialogContainerPreview | undefined
): string[] {
  if (preview?.variant !== 'item-grid') return [];
  const warnings: string[] = [];
  const dimensions = new Set<DialogItemGridField>(['iwidth', 'iheight']);
  const tracks = new Set<DialogItemGridField>(['count', 'row']);
  const exactCaseFields = new Set<DialogItemGridField>([
    'conditionEx', 'conditionParam', 'conditionOnOff',
  ]);
  const defaultFields = preview.defaultFields as DialogItemGridField[] | undefined;
  const dynamicFields = preview.dynamicFields as DialogItemGridField[] | undefined;
  const invalidFields = preview.invalidFields as DialogItemGridField[] | undefined;
  const select = (
    fields: DialogItemGridField[] | undefined,
    accepted: Set<DialogItemGridField>
  ) => (fields || []).filter(field => accepted.has(field));
  const defaultDimensions = select(defaultFields, dimensions);
  const defaultTracks = select(defaultFields, tracks);
  const dynamicDimensions = select(dynamicFields, dimensions);
  const dynamicTracks = select(dynamicFields, tracks);
  const invalidDimensions = select(invalidFields, dimensions);
  const invalidTracks = select(invalidFields, tracks);
  const invalidExactCase = select(invalidFields, exactCaseFields);
  const dynamicConfig = (dynamicFields || []).filter(
    field => !dimensions.has(field) && !tracks.has(field)
  );
  const invalidConfig = (invalidFields || []).filter(
    field => !dimensions.has(field) && !tracks.has(field) && !exactCaseFields.has(field)
  );
  if (defaultDimensions.length > 0) {
    warnings.push(
      `996PC 手册未公开未填写时的默认格子尺寸，Ctrl+F12 对 ${defaultDimensions.join('、')} 使用 40px 预览约定`
    );
  }
  if (defaultTracks.length > 0) {
    warnings.push(
      `996PC 手册未公开省略 ${defaultTracks.join('、')} 时的默认值，Ctrl+F12 使用 count=12、row=4 的预览约定`
    );
  }
  if (dynamicDimensions.length > 0) {
    warnings.push(
      `物品格子的 ${dynamicDimensions.join('、')} 包含动态值，无法静态求值，对应轴使用 40px 预览回退`
    );
  }
  if (dynamicTracks.length > 0) {
    warnings.push(
      `物品格子的 ${dynamicTracks.join('、')} 包含动态值，无法静态求值，使用 count=12、row=4 的安全预览回退`
    );
  }
  if (dynamicConfig.length > 0) {
    warnings.push(
      `物品格子的 ${dynamicConfig.join('、')} 包含动态值，静态预览保留未知状态，不借用变量当前值`
    );
  }
  if (invalidDimensions.length > 0) {
    warnings.push(
      `物品格子的 ${invalidDimensions.join('、')} 必须是正数，当前对应轴使用 40px 预览回退`
    );
  }
  if (invalidTracks.length > 0) {
    warnings.push(
      `物品格子的 ${invalidTracks.join('、')} 必须是正整数，当前使用 count=12、row=4 的安全预览回退`
    );
  }
  if (invalidExactCase.length > 0) {
    warnings.push(
      `物品格子的 ${invalidExactCase.join('、')} 参数无效或大小写不正确；996PC 手册要求严格使用 conditionEx、conditionParam、conditionOnOff`
    );
  }
  if (invalidConfig.length > 0) {
    warnings.push(
      `物品格子的 ${invalidConfig.join('、')} 参数无效，开关和选择方式仅支持 0 或 1，静态预览保留安全状态`
    );
  }
  return warnings;
}

function itemGridCellDimension(
  value: ValueSpan | undefined,
  field: 'iwidth' | 'iheight',
  diagnostics: ItemGridDiagnostics
): number {
  if (!value) {
    pushUniqueGridField(diagnostics.defaultFields, field);
    return ITEM_GRID_PREVIEW_CELL_SIZE;
  }
  const parsed = numericValue(value);
  if (parsed !== undefined && Number.isFinite(parsed) && parsed > 0) return parsed;
  if (/<\$/i.test(value.raw)) pushUniqueGridField(diagnostics.dynamicFields, field);
  else pushUniqueGridField(diagnostics.invalidFields, field);
  return ITEM_GRID_PREVIEW_CELL_SIZE;
}

function itemGridPreviewSize(
  preview: DialogContainerPreview,
  axis: 'width' | 'height'
): number {
  const trackCount = Math.max(1, Number(
    axis === 'width' ? preview.columns : preview.rows
  ) || 1);
  const cellSize = Math.max(1, Number(
    axis === 'width' ? preview.cellWidth : preview.cellHeight
  ) || ITEM_GRID_PREVIEW_CELL_SIZE);
  const gap = preview.cellGap === undefined
    ? ITEM_GRID_PREVIEW_GAP
    : Math.max(0, Number(preview.cellGap) || 0);
  return trackCount * cellSize + Math.max(0, trackCount - 1) * gap;
}

function cleanStaticValue(value: ValueSpan | undefined): string | undefined {
  if (!value) return undefined;
  const result = stripValueSuffix(value.raw).trim();
  return result && !/<\$/i.test(result) ? result : undefined;
}

function stripValueSuffix(value: string): string {
  return value.trim().replace(/\s*(?:\/@.*|[|{].*)$/, '').replace(/^['"]|['"]$/g, '');
}

function statementKind(id: string, token: string): DialogElementKind {
  const value = `${id} ${token}`.toLowerCase();
  if (/newui-(?:hero)?(?:bagitems|equipitems)-996pc/.test(id.toLowerCase())) return 'container';
  if (id.toLowerCase() === 'newui-menuitem-996pc') return 'menu';
  if (/^image-countdown(?:-relative-compat)?$/.test(id)
    || id === 'newui-textatlas-996pc'
    || id === 'textatlas-996pc') return 'image';
  if (value.includes('input') || value.includes('memo')) return 'input';
  if (value.includes('text') || value.includes('mtext') || value.includes('timetips') || value.includes('countdown')) return 'text';
  if (value.includes('imgex') || value.includes('button') || value.includes('checkbox')) return 'button';
  if (value.includes('play') || value.includes('frame') || value.includes('effect')) return 'animation';
  if (value.includes('progress') || value.includes('loading') || value.includes('slider') || value.includes('percent')) return 'progress';
  if (value.includes('item') || value.includes('equip') || value.includes('looks') || value.includes('dnitems')) return 'item';
  if (value.includes('layout') || value.includes('listview') || value.includes('container')) return 'container';
  if (value.includes('monster') || value.includes('uimodel')) return 'monster';
  if (value.includes('img') || value.includes('newopui')) return 'image';
  return 'generic';
}

function defaultElementSize(kind: DialogElementKind): { width: number; height: number } {
  switch (kind) {
    case 'text': return { width: 160, height: 20 };
    case 'button': return { width: 96, height: 30 };
    case 'image':
    case 'animation': return { width: 72, height: 72 };
    case 'input': return { width: 160, height: 28 };
    case 'progress': return { width: 180, height: 24 };
    case 'item': return { width: 40, height: 40 };
    case 'menu': return { width: 180, height: 30 };
    case 'container': return { width: 220, height: 120 };
    case 'monster': return { width: 120, height: 160 };
    default: return { width: 120, height: 32 };
  }
}

function fallbackElementText(kind: DialogElementKind, raw: string): string {
  if (kind === 'input') return '输入框';
  if (kind === 'progress') return '进度条';
  if (kind === 'item') return '物品/装备';
  if (kind === 'menu') return '下拉菜单';
  if (kind === 'container') return '容器';
  if (kind === 'monster') return '模型预览';
  return raw.slice(0, 42);
}

function statementColor(raw: string): string | undefined {
  const value = /(?:FCOLOR|COLOR)\s*=\s*([^;}|>]+)/i.exec(raw)?.[1]?.trim();
  return value ? parseDialogColor(value) : undefined;
}

function statementValueColor(value: ValueSpan | undefined): string | undefined {
  const raw = cleanStaticValue(value);
  return raw ? parseDialogColor(raw) : undefined;
}

function statementColorValues(value: ValueSpan | undefined): string[] | undefined {
  const raw = cleanStaticValue(value);
  return raw ? splitDialogColorValues(raw) : undefined;
}

function statementValueColors(value: ValueSpan | undefined): string[] | undefined {
  const raw = cleanStaticValue(value);
  return raw ? parseDialogColors(raw) : undefined;
}

function parseDialogColor(value: string): string | undefined {
  return splitDialogColorValues(value)?.map(parseSingleDialogColor)[0];
}

function splitDialogColorValues(value: string): string[] | undefined {
  const normalized = value.trim().replace(/^\{\s*|\s*\}$/g, '');
  const parts = normalized.split(',').map(part => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseDialogColors(value: string): string[] | undefined {
  const parts = splitDialogColorValues(value);
  if (!parts) return undefined;
  const colors = parts.map(parseSingleDialogColor);
  return colors.every((color): color is string => Boolean(color)) ? colors : undefined;
}

function parseSingleDialogColor(value: string): string | undefined {
  if (/^\$[0-9A-F]{6}$/i.test(value)) return bgrHexToCss(value.slice(1));
  if (/^#[0-9A-F]{6}$/i.test(value)) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return legendColor(number);
}

function bgrHexToCss(bgr: string): string {
  return `#${bgr.slice(4, 6)}${bgr.slice(2, 4)}${bgr.slice(0, 2)}`;
}

function cleanDisplayText(value: string, multiline: boolean): string {
  const trimmed = value.trim();
  const pipe = multiline ? -1 : findTopLevelPipe(trimmed);
  let content = pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
  if (multiline) {
    // In documented MText syntax the pipe is the displayed line separator;
    // an immediately following physical CR/LF is the same separator, not an
    // extra blank row. Preserve any other physical newline conservatively.
    content = content
      .replace(/\|[\t ]*\r?\n[\t ]*/g, '\n')
      .replace(/\|/g, '\n');
  }
  return content
    .replace(/\\\\/g, '\n')
    .replace(/\\$/g, '')
    .trim();
}

function flowTextElement(
  source: string,
  line: ScriptLine,
  start: number,
  end: number,
  text: string,
  flow: FlowLayoutCursor,
  width: number,
  runs?: DialogTextRun[]
): DialogElement {
  const raw = source.slice(start, end);
  return {
    id: `${start}:flow-text`,
    statementId: 'flow-text',
    token: '<文字>',
    description: '传统 NPC 对话文字或动态输出',
    kind: 'text',
    raw,
    lineNumber: line.lineNumber + 1,
    sourceRange: span(source, start, end),
    coordinateMode: 'flow',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: flow.x,
    localLayoutY: flow.y,
    layoutX: flow.x,
    layoutY: flow.y,
    width: Math.max(6, width),
    height: 20,
    text,
    color: runs ? undefined : statementColor(raw),
    ...(runs ? { textPreview: { lines: [runs], align: 'left' } } : {}),
    warning: '传统流式文字没有独立 X/Y，位置由客户端列表布局决定',
  };
}

function summarizeCondition(
  marker: '#SAY' | '#ELSESAY',
  conditions: string[],
  operators: DialogConditionOperator[]
): string {
  if (conditions.length === 0) return marker === '#ELSESAY' ? '否则界面' : '默认界面';
  const joined = conditions.map((condition, index) => {
    if (index === 0) return condition;
    return `${operators[index] === 'OR' ? '或' : '且'} ${condition}`;
  }).join(' ');
  return marker === '#ELSESAY' ? `否则: ${joined}` : joined;
}

function groupSchemas(catalog: DialogStatementSchema[]): Map<string, DialogStatementSchema[]> {
  const result = new Map<string, DialogStatementSchema[]>();
  for (const schema of catalog) {
    const key = schema.token.toUpperCase();
    const values = result.get(key) || [];
    values.push(schema);
    result.set(key, values);
  }
  return result;
}

function applyContainerLayout(
  elements: DialogElement[],
  offsets: NpcDialogOffsets,
  warnings: string[]
): void {
  for (const element of elements) element.parentElementId = undefined;
  const byContainerId = new Map<string, DialogElement>();
  for (const element of elements) {
    if (!element.containerElementId) continue;
    if (byContainerId.has(element.containerElementId)) {
      pushUniqueWarning(
        warnings,
        `容器 ID ${element.containerElementId} 重复，已按首个元素建立父子关系`
      );
      continue;
    }
    byContainerId.set(element.containerElementId, element);
  }

  for (const parent of elements) {
    for (const childId of parent.containerChildIds || []) {
      const child = byContainerId.get(childId);
      if (!child || child === parent || child.parentElementId) continue;
      child.parentElementId = parent.id;
      if (!child.containerParentId) {
        child.containerParentId = parent.containerElementId || parent.id;
      }
    }
  }

  for (const element of elements) {
    if (element.parentElementId || !element.containerParentId) continue;
    const parent = byContainerId.get(element.containerParentId);
    if (!parent) {
      appendElementWarning(element, `父容器 ${element.containerParentId} 未在当前界面中找到`);
      continue;
    }
    element.parentElementId = parent.id;
  }

  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const byElementId = new Map(elements.map(element => [element.id, element]));
  const resolve = (element: DialogElement): void => {
    if (resolved.has(element.id)) return;
    if (resolving.has(element.id)) {
      appendElementWarning(element, '容器父子关系存在循环，已停止嵌套定位');
      pushUniqueWarning(warnings, '检测到循环容器关系，相关控件保持局部坐标');
      return;
    }
    resolving.add(element.id);
    const parent = element.parentElementId
      ? byElementId.get(element.parentElementId)
      : undefined;
    if (parent) resolve(parent);
    applyElementSize(element, parent);
    resetElementLocalPosition(element, parent, offsets);
    apply996StaticLayout(element, parent);
    if (parent) {
      element.layoutX = parent.layoutX + element.localLayoutX;
      element.layoutY = parent.layoutY + element.localLayoutY;
    } else {
      element.layoutX = element.localLayoutX;
      element.layoutY = element.localLayoutY;
    }
    resolving.delete(element.id);
    resolved.add(element.id);
  };
  elements.forEach(resolve);
  applyStructuredContainerLayout(elements);
  refreshGlobalContainerPositions(elements);
}

function applyStructuredContainerLayout(elements: DialogElement[]): void {
  for (const parent of elements) {
    if (parent.containerPreview?.variant === 'list') {
      arrangeListViewChildren(parent, elements);
    } else if (
      parent.statementId === 'container-layout'
      && parent.containerPreview?.variant === 'layout'
    ) {
      arrangeLegacyContainerFlow(parent, elements);
    }
  }
}

function arrangeListViewChildren(parent: DialogElement, elements: DialogElement[]): void {
  const preview = parent.containerPreview!;
  const children = orderedListViewChildren(parent, elements)
    .filter(child => child.containerPreview?.variant !== 'line-break');
  const horizontal = preview.direction === 'horizontal';
  const gap = Number.isFinite(preview.gap) ? Number(preview.gap) : 0;
  const starts: number[] = [];
  let cursor = 0;
  let crossMin = 0;
  let crossMax = 0;

  for (const child of children) {
    starts.push(cursor);
    const cross = listChildCrossPosition(child, horizontal ? 'y' : 'x');
    const primarySize = Math.max(1, horizontal ? child.width : child.height);
    const crossSize = Math.max(1, horizontal ? child.height : child.width);
    if (horizontal) {
      child.localLayoutX = cursor;
      child.localLayoutY = cross;
    } else {
      child.localLayoutX = cross;
      child.localLayoutY = cursor;
    }
    cursor += primarySize + gap;
    crossMin = Math.min(crossMin, cross);
    crossMax = Math.max(crossMax, cross + crossSize);
  }

  const contentPrimary = children.length > 0 ? Math.max(0, cursor - gap) : 0;
  const requestedIndex = Math.max(0, Math.trunc(
    Number(preview.effectiveDefaultIndex ?? preview.defaultIndex) || 0
  ));
  const defaultIndex = children.length > 0
    ? Math.min(requestedIndex, children.length - 1)
    : 0;
  const viewportPrimary = Math.max(1, horizontal ? parent.width : parent.height);
  const scrollOffset = Math.min(
    starts[defaultIndex] || 0,
    Math.max(0, contentPrimary - viewportPrimary)
  );
  for (const child of children) {
    if (horizontal) child.localLayoutX -= scrollOffset;
    else child.localLayoutY -= scrollOffset;
  }

  const contentCross = Math.max(0, crossMax - crossMin);
  preview.effectiveDefaultIndex = defaultIndex;
  preview.defaultIndex = defaultIndex;
  preview.scrollOffset = scrollOffset;
  preview.contentWidth = horizontal ? contentPrimary : contentCross;
  preview.contentHeight = horizontal ? contentCross : contentPrimary;
}

function orderedListViewChildren(
  parent: DialogElement,
  elements: DialogElement[]
): DialogElement[] {
  const direct = elements.filter(element => element.parentElementId === parent.id);
  if (!parent.containerChildIds?.length) return direct;
  const byContainerId = new Map(
    direct.flatMap(element => element.containerElementId
      ? [[element.containerElementId, element] as const]
      : [])
  );
  const declared = parent.containerChildIds.flatMap(id => {
    const element = byContainerId.get(id);
    return element ? [element] : [];
  });
  const declaredIds = new Set(declared.map(element => element.id));
  return [...declared, ...direct.filter(element => !declaredIds.has(element.id))];
}

function listChildCrossPosition(
  child: DialogElement,
  axis: 'x' | 'y'
): number {
  const coordinateValue = axis === 'x' ? child.x : child.y;
  if (!coordinateValue) return 0;
  return axis === 'x' ? child.localLayoutX : child.localLayoutY;
}

function arrangeLegacyContainerFlow(parent: DialogElement, elements: DialogElement[]): void {
  const children = elements.filter(element => element.parentElementId === parent.id);
  let cursorX = 0;
  let cursorY = 0;
  let lineHeight = 20;
  for (const child of children) {
    if (child.containerPreview?.variant === 'line-break') {
      child.localLayoutX = cursorX;
      child.localLayoutY = cursorY;
      cursorX = 0;
      cursorY += Math.max(20, lineHeight);
      lineHeight = 20;
      continue;
    }
    if (!isLegacyContainerFlowText(child)) continue;
    const fontSize = Number(child.textPreview?.fontSize) > 0
      ? Number(child.textPreview?.fontSize)
      : 12;
    child.width = Math.max(1, Math.ceil(scaledDialogTextWidth(child.text || '', fontSize)));
    child.height = Math.max(20, Math.ceil(fontSize * 1.2));
    child.localLayoutX = cursorX;
    child.localLayoutY = cursorY;
    cursorX += child.width;
    lineHeight = Math.max(lineHeight, child.height);
  }
}

function isLegacyContainerFlowText(element: DialogElement): boolean {
  if (element.kind !== 'text') return false;
  if (element.statementId === 'container-mtext') return false;
  if (!element.x && !element.y) return true;
  return Boolean(
    element.x
    && element.y
    && element.x.sourceValue === 0
    && element.y.sourceValue === 0
  );
}

function refreshGlobalContainerPositions(elements: DialogElement[]): void {
  const byId = new Map(elements.map(element => [element.id, element]));
  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const resolve = (element: DialogElement): void => {
    if (resolved.has(element.id) || resolving.has(element.id)) return;
    resolving.add(element.id);
    const parent = element.parentElementId ? byId.get(element.parentElementId) : undefined;
    if (parent) resolve(parent);
    element.layoutX = element.localLayoutX + (parent?.layoutX || 0);
    element.layoutY = element.localLayoutY + (parent?.layoutY || 0);
    resolving.delete(element.id);
    resolved.add(element.id);
  };
  elements.forEach(resolve);
}

function applyElementSize(
  element: DialogElement,
  parent: DialogElement | undefined
): void {
  refreshDialogModelBounds(element);
  refreshAnimationBounds(element);
  const preview = element.sizePreview;
  if (!preview) return;
  const referenceWidth = parent?.width || DEFAULT_PREVIEW_WIDTH;
  const referenceHeight = parent?.height || DEFAULT_PREVIEW_HEIGHT;
  element.width = resolvedElementSize(
    element,
    preview.width,
    referenceWidth,
    element.layoutPreview?.percentWidth,
    'width'
  );
  element.height = resolvedElementSize(
    element,
    preview.height,
    referenceHeight,
    element.layoutPreview?.percentHeight,
    'height'
  );
}

function resolvedElementSize(
  element: DialogElement,
  preview: DialogSizeAxisPreview,
  reference: number,
  percentage: number | undefined,
  axis: 'width' | 'height'
): number {
  if (preview.mode === 'percent' && percentage !== undefined) {
    return percentageLength(reference, percentage);
  }
  if (preview.mode === 'intrinsic') {
    return intrinsicAssetDimension(element, axis) ?? preview.baseValue;
  }
  return preview.baseValue;
}

function intrinsicAssetDimension(
  element: DialogElement,
  axis: 'width' | 'height'
): number | undefined {
  const modelBounds = element.modelPreview?.bounds;
  if (modelBounds) return modelBounds[axis];
  const animationBounds = element.animationPreview?.bounds;
  if (animationBounds) return animationBounds[axis];
  const imageTextDimension = intrinsicImageTextDimension(element, axis);
  if (imageTextDimension !== undefined) return imageTextDimension;
  const costItemDimension = intrinsicCostItemDimension(element, axis);
  if (costItemDimension !== undefined) return costItemDimension;
  const preferredRoles = ['background', 'progress', 'item'];
  const layers = element.assetLayers || [];
  const selected = element.togglePreview?.checked === true
    ? layers.find(layer => layer.role === 'selected')?.asset
    : undefined;
  const previews = [
    selected,
    element.asset,
    ...preferredRoles.map(role => layers.find(layer => layer.role === role)?.asset),
  ];
  for (const preview of previews) {
    if (preview?.status !== 'ready') continue;
    const value = Number(preview[axis]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function refreshAnimationBounds(element: DialogElement): void {
  const preview = element.animationPreview;
  if (!preview) return;
  const frames = (element.animationFrames || []).filter(frame => frame?.status === 'ready');
  if (frames.length === 0) {
    delete preview.bounds;
    return;
  }
  const useOffsets = preview.offsetPolicy === 'asset'
    || (preview.offsetPolicy === 'switch' && preview.repairMode === 1);
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const frame of frames) {
    const width = Math.max(0, Number(frame.width) || 0);
    const height = Math.max(0, Number(frame.height) || 0);
    const offsetX = useOffsets ? Number(frame.offsetX) || 0 : 0;
    const offsetY = useOffsets ? Number(frame.offsetY) || 0 : 0;
    minX = Math.min(minX, offsetX);
    minY = Math.min(minY, offsetY);
    maxX = Math.max(maxX, offsetX + width);
    maxY = Math.max(maxY, offsetY + height);
  }
  const scale = Number(preview.scale) > 0 ? Number(preview.scale) : 1;
  preview.bounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, (maxX - minX) * scale),
    height: Math.max(1, (maxY - minY) * scale),
  };
}

function intrinsicCostItemDimension(
  element: DialogElement,
  axis: 'width' | 'height'
): number | undefined {
  const preview = element.costItemPreview;
  if (!preview) return undefined;
  const fontSize = Number(preview.fontSize) > 0 ? Number(preview.fontSize) : 12;
  const itemScale = Number(preview.itemScale) > 0 ? Number(preview.itemScale) : 1;
  const icon = costItemIconMetrics(element, itemScale);
  if (axis === 'height') return Math.max(Math.ceil(fontSize * 1.2), icon.height);
  return Math.ceil(
    scaledDialogTextWidth(preview.title, fontSize)
    + icon.width
    + scaledDialogTextWidth(`/${preview.quantityText}`, fontSize)
    + 8
  );
}

function costItemIconMetrics(
  element: DialogElement,
  scale: number
): { width: number; height: number } {
  const itemAsset = (element.assetLayers || []).find(layer => layer.role === 'item')?.asset;
  const ready = itemAsset?.status === 'ready';
  const imageWidth = (ready && Number(itemAsset.width) > 0 ? Number(itemAsset.width) : 32) * scale;
  const imageHeight = (ready && Number(itemAsset.height) > 0 ? Number(itemAsset.height) : 32) * scale;
  const offsetX = ready ? (Number(itemAsset.offsetX) || 0) * scale : 0;
  const offsetY = ready ? (Number(itemAsset.offsetY) || 0) * scale : 0;
  const minX = Math.min(0, offsetX);
  const minY = Math.min(0, offsetY);
  return {
    width: Math.max(1, Math.max(0, offsetX + imageWidth) - minX),
    height: Math.max(1, Math.max(0, offsetY + imageHeight) - minY),
  };
}

function scaledDialogTextWidth(value: string, fontSize: number): number {
  return flowTextWidth(value) * fontSize / 12;
}

function dialogTextPreviewSize(preview: DialogTextPreview): { width: number; height: number } {
  const fontSize = Number(preview.fontSize) > 0 ? Number(preview.fontSize) : 12;
  const lines = preview.lines.length > 0 ? preview.lines : [[{ text: '' }]];
  const width = Math.max(...lines.map(line => (
    scaledDialogTextWidth(line.map(run => run.text).join(''), fontSize)
  )));
  return {
    width: Math.max(20, Math.ceil(width)),
    height: Math.max(8, Math.ceil(lines.length * fontSize * 1.35)),
  };
}

function refreshDialogModelBounds(element: DialogElement): void {
  if (!element.modelPreview) return;
  const bounds = dialogModelBounds(element.modelPreview);
  if (bounds) element.modelPreview.bounds = bounds;
  else delete element.modelPreview.bounds;
}

function dialogModelBounds(
  preview: DialogModelPreview | undefined
): NonNullable<DialogModelPreview['bounds']> | undefined {
  if (!preview) return undefined;
  const rectangles = preview.layers.flatMap(layer => {
    const asset = layer.asset;
    const width = Number(asset?.width);
    const height = Number(asset?.height);
    if (asset?.status !== 'ready'
      || !Number.isFinite(width) || width <= 0
      || !Number.isFinite(height) || height <= 0) return [];
    const x = Number(asset.offsetX) || 0;
    const y = Number(asset.offsetY) || 0;
    return [{ x, y, width, height }];
  });
  if (rectangles.length === 0) return undefined;
  const minX = Math.min(...rectangles.map(rectangle => rectangle.x));
  const minY = Math.min(...rectangles.map(rectangle => rectangle.y));
  const maxX = Math.max(...rectangles.map(rectangle => rectangle.x + rectangle.width));
  const maxY = Math.max(...rectangles.map(rectangle => rectangle.y + rectangle.height));
  const scale = Number.isFinite(preview.scale) && preview.scale > 0 ? preview.scale : 1;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, (maxX - minX) * scale),
    height: Math.max(1, (maxY - minY) * scale),
  };
}

function intrinsicImageTextDimension(
  element: DialogElement,
  axis: 'width' | 'height'
): number | undefined {
  const preview = element.imageTextPreview;
  if (!preview || preview.glyphs.length === 0) return undefined;
  if (preview.mode === 'atlas') {
    const glyphSize = axis === 'width' ? preview.glyphWidth : preview.glyphHeight;
    if (!Number.isSafeInteger(glyphSize) || glyphSize! <= 0) return undefined;
    return axis === 'width'
      ? Math.max(1, glyphSize! * preview.glyphs.length
        + preview.gap * Math.max(0, preview.glyphs.length - 1))
      : glyphSize!;
  }
  const dimensions = preview.glyphs.map(glyph => (
    glyph.asset?.status === 'ready' ? Number(glyph.asset[axis]) : 0
  ));
  if (preview.textAtlasVariant === 'legacy-individual') {
    if (dimensions.some(value => !Number.isFinite(value) || value <= 0)) return undefined;
    return axis === 'height'
      ? Math.max(...dimensions)
      : Math.max(1, dimensions.reduce((total, value) => total + value, 0)
        + preview.gap * Math.max(0, preview.glyphs.length - 1));
  }
  const declared = axis === 'width' ? preview.glyphWidth : preview.glyphHeight;
  const fallback = Number(declared) > 0
    ? Number(declared)
    : dimensions.find(value => Number.isFinite(value) && value > 0) || 0;
  if (fallback <= 0) return undefined;
  if (axis === 'height') {
    return Math.max(fallback, ...dimensions.filter(value => Number.isFinite(value) && value > 0));
  }
  const width = dimensions.reduce((total, value) => (
    total + (Number.isFinite(value) && value > 0 ? value : fallback)
  ), 0) + preview.gap * Math.max(0, preview.glyphs.length - 1);
  return Math.max(1, width);
}

function resetElementLocalPosition(
  element: DialogElement,
  parent: DialogElement | undefined,
  offsets: NpcDialogOffsets
): void {
  const relativeTopLevel = element.coordinateMode === 'relative' && !parent;
  if (element.x) {
    element.localLayoutX = element.x.sourceValue
      - element.sourceCoordinateBiasX
      + (relativeTopLevel ? offsets.memoX : 0);
  }
  if (element.y) {
    element.localLayoutY = element.y.sourceValue
      - element.sourceCoordinateBiasY
      + (relativeTopLevel ? offsets.memoY : 0);
  }
}

function apply996StaticLayout(
  element: DialogElement,
  parent: DialogElement | undefined
): void {
  const preview = element.layoutPreview;
  if (!preview) return;
  const referenceWidth = parent?.width || DEFAULT_PREVIEW_WIDTH;
  const referenceHeight = parent?.height || DEFAULT_PREVIEW_HEIGHT;
  if (!requiresStaticPositionLayout(preview)) return;

  if (preview.legacyCenterX || preview.legacyCenterY) {
    if (preview.legacyCenterX) {
      element.localLayoutX = (referenceWidth - element.width) / 2
        + (Number(preview.legacyCenterOffsetX) || 0);
    }
    if (preview.legacyCenterY) {
      element.localLayoutY = (referenceHeight - element.height) / 2
        + (Number(preview.legacyCenterOffsetY) || 0);
    }
    return;
  }

  const anchor = Number.isInteger(preview.anchor) ? preview.anchor! : 0;
  const target = anchorTarget(anchor, referenceWidth, referenceHeight);
  if (preview.percentX !== undefined) {
    target.x = referenceWidth * preview.percentX / 100;
  } else if (element.x) {
    target.x += element.x.sourceValue - element.sourceCoordinateBiasX;
  }
  if (preview.percentY !== undefined) {
    target.y = referenceHeight * preview.percentY / 100;
  } else if (element.y) {
    target.y += element.y.sourceValue - element.sourceCoordinateBiasY;
  }
  const modelMetrics = dialogModelVisualMetrics(element);
  const pivot = anchorPivot(
    anchor,
    modelMetrics?.width ?? element.width,
    modelMetrics?.height ?? element.height,
    preview.anchorX,
    preview.anchorY
  );
  element.localLayoutX = target.x - pivot.x - (modelMetrics?.offsetX ?? 0);
  element.localLayoutY = target.y - pivot.y - (modelMetrics?.offsetY ?? 0);
}

function dialogModelVisualMetrics(element: DialogElement): {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
} | undefined {
  const preview = element.modelPreview;
  const bounds = preview?.bounds;
  if (!preview || !bounds) return undefined;
  const scale = Number.isFinite(preview.scale) && preview.scale > 0 ? preview.scale : 1;
  return {
    offsetX: bounds.minX * scale,
    offsetY: bounds.minY * scale,
    width: Math.max(element.width, bounds.width),
    height: Math.max(element.height, bounds.height),
  };
}

function percentageLength(reference: number, percentage: number): number {
  if (!Number.isFinite(percentage)) return reference;
  return Math.max(1, reference * Math.max(0, percentage) / 100);
}

function anchorTarget(
  anchor: number,
  width: number,
  height: number
): { x: number; y: number } {
  const x = [1, 3].includes(anchor) ? width
    : [4, 8].includes(anchor) ? width / 2
      : 0;
  const y = [2, 3].includes(anchor) ? height
    : [4, 7].includes(anchor) ? height / 2
      : 0;
  return { x, y };
}

function anchorPivot(
  anchor: number,
  width: number,
  height: number,
  anchorX: number | undefined,
  anchorY: number | undefined
): { x: number; y: number } {
  const preset = anchorTarget(anchor, width, height);
  return {
    x: explicitAnchorOffset(anchorX, width) ?? preset.x,
    y: explicitAnchorOffset(anchorY, height) ?? preset.y,
  };
}

function explicitAnchorOffset(value: number | undefined, size: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return size * value;
}

function runtimeTextValueStatus(
  sourceText: string,
  variables: readonly DialogResolvedVariable[]
): NonNullable<DialogTextPreview['textValueStatus']> {
  const names = runtimeVariableNamesInText(sourceText);
  if (names.length === 0) return 'runtime-placeholder';
  const statuses = new Map(variables.map(variable => [
    variable.name.trim().toUpperCase(),
    variable.status,
  ]));
  return names.every(name => statuses.get(name) === 'resolved')
    ? 'resolved-static'
    : 'runtime-placeholder';
}

function runtimeVariableNamesInText(value: string): string[] {
  const names = new Set<string>();
  if (!/<\$/i.test(value)) return [];
  const expression = /(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+)/giu;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value)) !== null) {
    names.add(match[0].toUpperCase());
  }
  return [...names];
}

function itemIndexSourceExpression(element: DialogElement): string | undefined {
  if (element.statementId === 'item-show') return sourceParameterValue(element, 1);
  if (element.statementId === 'newui-itemshow-996pc'
    || element.statementId === 'newui-costitem-996pc') {
    return sourceParameterValue(element, 'itemid');
  }
  return undefined;
}

/**
 * Return the one variable named by a direct runtime projection. ITEMSHOW's
 * database capability must not survive string concatenation, literal prefixes,
 * nested slot selection, arithmetic, or any other expression transform.
 */
function directRuntimeVariableName(value: string): string | undefined {
  const match = /^(?:<\$STR\(\s*((?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+))\s*\)>|<\$\s*((?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+))\s*>)$/iu
    .exec(value.trim());
  return (match?.[1] || match?.[2])?.toUpperCase();
}

/**
 * A visible MOV snapshot is not allowed to select an asset. The one safe
 * exception is a complete GETDBITEMFIELDVALUE ... IDX result: it is already a
 * static lookup against the same workspace database that Provider will use for
 * IDX -> Looks. Other database fields, copies and mutations are not IDX proof.
 */
function staticallyResolvedDatabaseItemIndex(
  sourceElement: DialogElement,
  evaluatedElement: DialogElement,
  variables: readonly DialogResolvedVariable[]
): number | undefined {
  const expression = itemIndexSourceExpression(sourceElement);
  const value = evaluatedElement.itemPreview?.itemIndex;
  const name = expression ? directRuntimeVariableName(expression) : undefined;
  if (!name || !Number.isSafeInteger(value) || value! < 0) return undefined;
  const byName = new Map(variables.map(variable => [
    variable.name.trim().toUpperCase(),
    variable,
  ]));
  const variable = byName.get(name);
  return variable?.status === 'resolved'
    && variable.staticValueSource === 'database-item-index'
    ? value
    : undefined;
}

function withoutItemShowDynamicWarning(warning: string | undefined): string | undefined {
  if (!warning) return undefined;
  const clauses = warning.split('；').filter(clause => (
    !/^\s*ItemShow 的 .* 包含动态值/.test(clause)
  ));
  return clauses.length > 0 ? clauses.join('；') : undefined;
}

function textFieldSourceDiagnostics(
  sourceElement: DialogElement,
  resolvedElement: DialogElement,
  variables: readonly DialogResolvedVariable[]
): DialogTextFieldSourceDiagnostic[] {
  const sourceFields = [...new Set(sourceElement.textPreview?.dynamicFields || [])];
  const resolvedInvalid = new Set(resolvedElement.textPreview?.invalidFields || []);
  return sourceFields.map(field => {
    const expression = textFieldSourceExpression(sourceElement, field) || sourceElement.raw;
    const variableNames = runtimeVariableNamesInText(expression);
    let status: DialogTextValueStatus = runtimeExpressionStatus(expression, variables);
    if (status === 'resolved-static' && field !== 'text' && resolvedInvalid.has(field)) {
      status = 'invalid-static';
    }
    return {
      field,
      expression,
      status,
      ...(variableNames.length > 0 ? { variableNames } : {}),
    };
  });
}

function runtimeExpressionStatus(
  expression: string,
  variables: readonly DialogResolvedVariable[]
): DialogTextValueStatus {
  if (!/<\$/i.test(expression)) return 'literal';
  const names = runtimeVariableNamesInText(expression);
  if (names.length === 0) return 'runtime-placeholder';
  const statuses = new Map(variables.map(variable => [
    variable.name.trim().toUpperCase(),
    variable.status,
  ]));
  return names.every(name => statuses.get(name) === 'resolved')
    ? 'resolved-static'
    : 'runtime-placeholder';
}

function displayValueSource(
  field: string,
  kind: DialogDisplayValueSource['kind'],
  expression: string | undefined,
  value: string | number,
  variables: readonly DialogResolvedVariable[],
  invalid = false
): DialogDisplayValueSource | undefined {
  if (expression === undefined) return undefined;
  const variableNames = runtimeVariableNamesInText(expression);
  const evaluated = runtimeExpressionStatus(expression, variables);
  const status: DialogTextValueStatus = invalid
    ? 'invalid-static'
    : evaluated;
  return {
    field,
    kind,
    expression,
    status,
    value,
    ...(variableNames.length > 0 ? { variableNames } : {}),
  };
}

function mergeDisplayValueSources(
  current: readonly DialogDisplayValueSource[] | undefined,
  additions: Array<DialogDisplayValueSource | undefined>
): DialogDisplayValueSource[] | undefined {
  const byField = new Map((current || []).map(value => [value.field, { ...value }]));
  for (const addition of additions) {
    if (addition) byField.set(addition.field, addition);
  }
  return byField.size > 0 ? [...byField.values()] : undefined;
}

function sourceParameterValue(
  element: DialogElement,
  keyOrIndex: string | number
): string | undefined {
  return element.parameters?.find(parameter => (
    typeof keyOrIndex === 'number'
      ? parameter.index === keyOrIndex
      : parameter.key?.toLowerCase() === keyOrIndex.toLowerCase()
  ))?.value;
}

function textFieldSourceExpression(
  element: DialogElement,
  field: DialogTextPreviewField
): string | undefined {
  if (field === 'text') return element.text || (element.parameters || []).find(parameter => (
    parameter.key?.toLowerCase() === 'text' || parameter.index === 1
  ))?.value;

  const keyByField: Partial<Record<DialogTextPreviewField, string>> = {
    'simplify-number': 'simplenum',
    color: 'color',
    'font-size': 'size',
    gray: 'grey',
    'outline-width': 'outline',
    'outline-color': 'outlinecolor',
    'scroll-width': 'scrollwidth',
    'scroll-height': 'scrollheight',
    'scroll-direction': 'scrollway',
    'scroll-duration': 'scrolltime',
  };
  const parameterKey = keyByField[field];
  if (parameterKey) {
    const parameter = (element.parameters || []).find(candidate => (
      candidate.key?.toLowerCase() === parameterKey
    ));
    if (parameter) return parameter.value;
  }

  const legacyKeyByField: Partial<Record<DialogTextPreviewField, string>> = {
    'simplify-number': 'SIMPLENUM',
    color: '(?:FCOLOR|AUTOCOLOR)',
    'font-size': 'FSIZE',
    'font-family': 'FNAME',
    'font-bold': 'FBOLD',
  };
  const legacyKey = legacyKeyByField[field];
  if (!legacyKey) return undefined;
  const match = new RegExp(`(?:^|[;{])\\s*(?:${legacyKey})\\s*=\\s*([^;}]+)`, 'iu')
    .exec(element.raw);
  return match?.[1]?.trim();
}

function mergeWarningClauses(...warnings: Array<string | undefined>): string | undefined {
  const clauses = new Set<string>();
  for (const warning of warnings) {
    for (const clause of warning?.split('；') || []) {
      const normalized = clause.trim();
      if (normalized) clauses.add(normalized);
    }
  }
  return clauses.size > 0 ? [...clauses].join('；') : undefined;
}

function appendElementWarning(element: DialogElement, message: string): void {
  element.warning = mergeWarningClauses(element.warning, message);
}

function pushUniqueWarning(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message);
}

function calculateCanvasSize(
  scenes: DialogScene[],
  offsets?: NpcDialogOffsets
): { width: number; height: number } {
  let width = 800;
  let height = 600;
  const measuredWindows = new Set<string>();
  for (const scene of scenes) {
    const window = scene.addDlgWindow;
    if (window && !measuredWindows.has(window.id)) {
      measuredWindows.add(window.id);
      const windowX = Number.isFinite(window.windowX) ? Number(window.windowX) : 0;
      const windowY = Number.isFinite(window.windowY) ? Number(window.windowY) : 0;
      const windowWidth = Number(window.asset?.width) > 0 ? Number(window.asset!.width) : 420;
      const windowHeight = Number(window.asset?.height) > 0 ? Number(window.asset!.height) : 300;
      width = Math.max(width, windowX + windowWidth + 80);
      height = Math.max(height, windowY + windowHeight + 80);
    }
    const byId = new Map(scene.elements.map(element => [element.id, element]));
    for (const element of scene.elements) {
      const modelMetrics = dialogModelVisualMetrics(element);
      const backgroundRoot = nearestShowPositionedBackground(element, byId);
      // bg/show makes the root X/Y irrelevant. Normalize the complete subtree
      // to that root so a child cannot leak the ignored source coordinates back
      // into the preview canvas, while its legitimate local extent still counts.
      let visualX = element.layoutX
        - (backgroundRoot?.layoutX ?? 0)
        + (modelMetrics?.offsetX ?? 0);
      let visualY = element.layoutY
        - (backgroundRoot?.layoutY ?? 0)
        + (modelMetrics?.offsetY ?? 0);
      const root = rootDialogElement(element, byId);
      if (
        window
        && Number.isFinite(window.windowX) && Number.isFinite(window.windowY)
        && Number.isFinite(window.textOffsetX) && Number.isFinite(window.textOffsetY)
      ) {
        if (root.coordinateMode === 'flow') {
          visualX += Number(window.windowX) + Number(window.textOffsetX)
            - ((Number(offsets?.menuX) || 0) + 18);
          visualY += Number(window.windowY) + Number(window.textOffsetY)
            - ((Number(offsets?.menuY) || 0) + 24);
        } else if (root.coordinateMode === 'relative') {
          visualX += Number(window.windowX) + Number(window.textOffsetX)
            - (Number(offsets?.memoX) || 0);
          visualY += Number(window.windowY) + Number(window.textOffsetY)
            - (Number(offsets?.memoY) || 0);
        }
      }
      const visualWidth = modelMetrics?.width ?? element.width;
      const visualHeight = modelMetrics?.height ?? element.height;
      width = Math.max(width, visualX + Math.max(40, visualWidth) + 80);
      height = Math.max(height, visualY + Math.max(24, visualHeight) + 80);
    }
  }
  return {
    width: Math.min(MAX_CANVAS_SIZE, Math.max(320, Math.ceil(width))),
    height: Math.min(MAX_CANVAS_SIZE, Math.max(240, Math.ceil(height))),
  };
}

function rootDialogElement(
  element: DialogElement,
  byId: ReadonlyMap<string, DialogElement>
): DialogElement {
  const visited = new Set<string>();
  let current = element;
  while (current.parentElementId && !visited.has(current.parentElementId)) {
    visited.add(current.parentElementId);
    const parent = byId.get(current.parentElementId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function applyShowPositionedBackgroundLayout(
  scenes: DialogScene[],
  canvas: { width: number; height: number }
): void {
  for (const scene of scenes) {
    const elements = scene.elements;
    const byId = new Map(elements.map(element => [element.id, element]));
    const backgrounds = elements
      .filter(isShowPositionedBackground)
      .sort((left, right) => elementParentDepth(left, byId) - elementParentDepth(right, byId));
    for (const background of backgrounds) {
      // A previous background can itself be this element's parent. Refresh first
      // so the subtraction below always uses the parent's effective show origin.
      refreshGlobalContainerPositions(elements);
      const target = showPositionedBackgroundTarget(
        background.imagePreview!.showPosition!,
        canvas,
        background.width,
        background.height
      );
      const parent = background.parentElementId
        ? byId.get(background.parentElementId)
        : undefined;
      background.localLayoutX = target.x - (parent?.layoutX || 0);
      background.localLayoutY = target.y - (parent?.layoutY || 0);
    }
    if (backgrounds.length > 0) refreshGlobalContainerPositions(elements);
  }
}

function showPositionedBackgroundTarget(
  show: 0 | 1 | 2 | 3 | 4,
  canvas: { width: number; height: number },
  elementWidth: number,
  elementHeight: number
): { x: number; y: number } {
  const right = canvas.width - elementWidth;
  const bottom = canvas.height - elementHeight;
  if (show === 0) return { x: 0, y: 0 };
  if (show === 1) return { x: right, y: 0 };
  if (show === 2) return { x: 0, y: bottom };
  if (show === 3) return { x: right, y: bottom };
  return { x: right / 2, y: bottom / 2 };
}

function nearestShowPositionedBackground(
  element: DialogElement,
  byId: ReadonlyMap<string, DialogElement>
): DialogElement | undefined {
  const visited = new Set<string>();
  let current: DialogElement | undefined = element;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (isShowPositionedBackground(current)) return current;
    current = current.parentElementId ? byId.get(current.parentElementId) : undefined;
  }
  return undefined;
}

function isShowPositionedBackground(element: DialogElement): boolean {
  const show = element.imagePreview?.showPosition;
  return Boolean(
    element.imagePreview?.background
    && Number.isInteger(show)
    && show! >= 0
    && show! <= 4
  );
}

function elementParentDepth(
  element: DialogElement,
  byId: ReadonlyMap<string, DialogElement>
): number {
  const visited = new Set<string>();
  let current: DialogElement | undefined = element;
  let depth = 0;
  while (current?.parentElementId && !visited.has(current.id)) {
    visited.add(current.id);
    current = byId.get(current.parentElementId);
    if (current) depth++;
  }
  return depth;
}

function hasRelativeCoordinates(scenes: DialogScene[]): boolean {
  return scenes.some(scene => scene.elements.some(element => element.coordinateMode === 'relative'));
}

function span(source: string, start: number, end: number): SourceSpan {
  return { start, end, original: source.slice(start, end) };
}

function parseInteger(value: string | undefined): number | undefined {
  return value && /^[+-]?\d+$/.test(value) ? Number(value) : undefined;
}

function cleanTargetLabel(value: string): string {
  return value.trim()
    .replace(/[>,}\]]+$/, '')
    .replace(/\([^)]*\)$/, '');
}

function directiveName(line: string): string | undefined {
  const match = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*$/i.exec(line);
  return match?.[1].toUpperCase();
}

function makeConditionGroupId(label: string, number: number): string {
  return `${normalizeLabel(label)}:CONDITION:${number}`;
}

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase();
}
