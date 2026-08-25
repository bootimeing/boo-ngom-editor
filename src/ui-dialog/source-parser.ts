import { EngineId } from '../types';
import { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import {
  DialogAssetLayer,
  DialogAssetReference,
  DialogAnimationPreview,
  DialogBackground,
  DialogConditionGroup,
  DialogConditionOperator,
  DialogContainerPreview,
  DialogCoordinate,
  DialogElement,
  DialogElementParameter,
  DialogElementKind,
  DialogItemPreview,
  DialogPagePreview,
  DialogProgressPreview,
  DialogResolvedVariable,
  DialogScene,
  DialogTooltipPreview,
  NpcDialogDocumentModel,
  NpcDialogOffsets,
  SourceSpan,
} from './model';
import { resolveItemFrameAssetReference } from './item-preview';
import { DialogStatementSchema } from './statement-catalog';
import {
  DialogLabelVariableResolution,
  resolveDialogVariables,
} from './variable-resolver';

const MAX_CANVAS_SIZE = 4096;

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
  itemPreview?: DialogItemPreview;
  progressPreview?: DialogProgressPreview;
  animationPreview?: DialogAnimationPreview;
  containerPreview?: DialogContainerPreview;
}

interface CoalescedConditionGroups {
  groups: DialogConditionGroup[];
  aliases: Map<string, string>;
  expandedStates: Record<string, boolean>;
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
  const sections = findFunctionSections(text, lines);
  const root = findFunctionAtOffset(sections, options.cursorOffset);
  if (!root) throw new Error('请将光标放在一个 [@函数] 内再按 Ctrl+F12');

  const warnings: string[] = [];
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
    conditionStates: coalescedConditions.expandedStates,
    dataOptions: options.dataOptions,
  });
  warnings.push(...variableResolution.warnings);
  const schemasByToken = groupSchemas(options.catalog);
  const scenes: DialogScene[] = [];
  for (const section of reachable) {
    scenes.push(...parseSectionScenes(
      text,
      section,
      options.offsets,
      schemasByToken,
      coalescedConditions.aliases,
      variableResolution.byLabel.get(normalizeLabel(section.label))
    ));
  }

  if (scenes.length === 0) {
    const fallback = parseStaticSectionScene(
      text,
      root,
      options.offsets,
      schemasByToken,
      variableResolution.byLabel.get(normalizeLabel(root.label))
    );
    if (fallback) {
      scenes.push(fallback);
      warnings.push('当前函数没有 #SAY/#ELSESAY，已按静态界面语句生成只读场景');
    }
  }
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

  const canvas = calculateCanvasSize(scenes);
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
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    conditionGroups,
    scenes,
    pages,
    warnings,
  };
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
    const background = activeScenes.find(scene => scene.background)?.background
      || pageScenes.find(scene => scene.background)?.background;
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
  return [...result];
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
  section: ScriptFunctionSection,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  conditionAliases: ReadonlyMap<string, string>,
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
  let defaultBackground: DialogBackground | undefined;

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
      const background = findBackgroundBefore(section.lines, index, source);
      const parsed = parseVisualElements(
        source,
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
        background: background || defaultBackground,
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
        if (background) defaultBackground = background;
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
  section: ScriptFunctionSection,
  offsets: NpcDialogOffsets,
  schemasByToken: Map<string, DialogStatementSchema[]>,
  variableResolution?: DialogLabelVariableResolution
): DialogScene | undefined {
  const blockLines = section.lines.slice(1);
  const parsed = parseVisualElements(
    source,
    blockLines,
    offsets,
    schemasByToken,
    variableResolution
  );
  const background = findBackgroundBefore(section.lines, section.lines.length, source);
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

function findSayBlockEnd(lines: ScriptLine[], start: number): number {
  for (let index = start; index < lines.length; index++) {
    if (/^\s*(?:#(?:IF|OR|ACT|ELSEACT|SAY|ELSESAY)\b|\[@)/i.test(lines[index].text)) {
      return index;
    }
  }
  return lines.length;
}

function findBackgroundBefore(
  lines: ScriptLine[],
  beforeIndex: number,
  source: string
): DialogBackground | undefined {
  for (let index = Math.min(beforeIndex - 1, lines.length - 1); index >= 0; index--) {
    const line = lines[index];
    if (/^\s*;/.test(line.text)) continue;
    const match = /^\s*OPENMERCHANTBIGDLG\s+(.+)$/i.exec(line.text);
    if (!match) continue;
    const args = match[1].trim().split(/\s+/);
    const willIndex = parseInteger(args[0]);
    const imageIndex = parseInteger(args[1]);
    return {
      raw: source.slice(line.start, line.end),
      lineNumber: line.lineNumber + 1,
      willIndex,
      imageIndex,
      assetRef: willIndex !== undefined && imageIndex !== undefined
        ? { willIndex, imageIndex }
        : undefined,
    };
  }
  return undefined;
}

function parseVisualElements(
  source: string,
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

  for (const line of lines) {
    if (!line.text.trim() || /^\s*;/.test(line.text)) continue;
    const resolution = variableResolution?.lines.get(line.lineNumber);
    resolution?.variables.forEach(variable => resolvedVariables.set(variable.name, variable));
    const displayText = resolution?.text ?? line.text;
    const generated = displayText !== line.text;
    const parsed = generated
      ? parseResolvedMarkupLine(source, line, displayText, offsets, schemasByToken, flow)
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
    warnings.push('由脚本变量展开的界面已按实际值预览；请到变量赋值语句修改其内部坐标');
  }
  return {
    elements,
    unsupported: [...unsupported],
    warnings,
    resolvedVariables: [...resolvedVariables.values()],
  };
}

function parseResolvedMarkupLine(
  source: string,
  originalLine: ScriptLine,
  resolvedText: string,
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
  parsed.elements.forEach((element, index) => {
    element.id = `${originalLine.start}:VARIABLE:${index}:${element.statementId}`;
    element.lineNumber = originalLine.lineNumber + 1;
    element.sourceRange = span(source, originalLine.start, originalLine.end);
    element.editable = false;
    element.warning = '此界面由脚本变量实际值展开，坐标需在变量赋值语句中修改';
  });
  return parsed;
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
    const schema = candidates.find(candidate => (
      (delimiter === '|' && candidate.syntax === 'key-value')
      || (delimiter === ':' && candidate.syntax === 'positional')
    )) || candidates[0];
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
    warning: '传统流式文字没有独立 X/Y，位置由客户端列表布局决定',
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
  const text = cleanFlowTextFragment(raw);
  const width = flowTextWidth(text);
  if (text.trim()) {
    result.push(flowTextElement(source, line, start, end, text, flow, width));
  }
  advanceFlowCursor(flow, width, 20);
}

function cleanFlowTextFragment(value: string): string {
  return value
    .replace(/&(?:#x20|nbsp);/gi, ' ')
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
    ? { positional: originalValues.positional.slice(1), keyed: originalValues.keyed }
    : originalValues;
  const xSpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.xKey)
    : positionalValue(values, schema.xParameter);
  const ySpan = schema.syntax === 'key-value'
    ? keyedValue(values, schema.yKey)
    : positionalValue(values, schema.yParameter);
  const xNumber = numericValue(xSpan);
  const yNumber = numericValue(ySpan);
  const coordinateMode = xSpan && ySpan
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
  const assetRef = statementAssetReference(values, schema);
  const controlPreview = statementControlPreview(values, schema, assetRef);
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
  const warning = xSpan && ySpan && (!x || !y)
    ? '动态坐标暂不可编辑'
    : schema.compatibilityAlias
      ? '兼容的不带 & 相对坐标语句，预览已叠加 M2 修正值'
      : undefined;
  const localLayoutX = x?.displayValue ?? offsets.menuX + 18;
  const localLayoutY = y?.displayValue ?? offsets.menuY + 24;
  const grid = controlPreview.containerPreview?.variant === 'item-grid'
    ? controlPreview.containerPreview
    : undefined;
  const elementWidth = numericValue(widthSpan)
    ?? (grid ? (grid.columns || 1) * 42 : defaults.width);
  const elementHeight = numericValue(heightSpan)
    ?? (grid ? (grid.rows || 1) * 42 : defaults.height);

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
    editable: Boolean(x && y),
    x,
    y,
    localLayoutX,
    localLayoutY,
    layoutX: localLayoutX,
    layoutY: localLayoutY,
    width: elementWidth,
    height: elementHeight,
    text: textSpan
      ? cleanDisplayText(textSpan.raw, schema.id === 'container-mtext')
      : controlPreview.itemPreview?.label || fallbackElementText(kind, raw),
    color: statementColor(raw),
    parameters: controlPreview.parameters,
    assetRef,
    assetLayers: controlPreview.assetLayers,
    animationPreview: controlPreview.animationPreview,
    tooltipPreview,
    itemPreview: controlPreview.itemPreview,
    progressPreview: controlPreview.progressPreview,
    containerPreview: controlPreview.containerPreview,
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
  if (syntax === 'key-value') {
    for (const segment of segments) {
      const raw = source.slice(segment.start, segment.end);
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
      if (!match) continue;
      const equals = raw.indexOf('=', match.index);
      const valueStart = segment.start + equals + 1;
      keyed.set(match[1].toLowerCase(), trimSpan(source, valueStart, segment.end));
    }
  }
  return { positional: segments.map(segment => trimSpan(source, segment.start, segment.end)), keyed };
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
  const match = /^\s*(#[A-Za-z0-9_$.-]+)?\s*~\s*(#[A-Za-z0-9_$.-]+)?\s*$/i.exec(cleaned);
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
  const match = /^([+-]?\d+)(?=\s*(?:$|[{}|/]))/.exec(value.raw);
  return match ? Number(match[1]) : undefined;
}

function coordinate(value: ValueSpan, sourceValue: number, displayValue: number): DialogCoordinate {
  const numeric = /^([+-]?\d+)/.exec(value.raw)!;
  const leading = value.raw.indexOf(numeric[1]);
  const start = value.start + leading;
  return {
    sourceValue,
    displayValue,
    span: { start, end: start + numeric[1].length, original: numeric[1] },
  };
}

function statementAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetReference | undefined {
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

function statementControlPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  primaryAsset: DialogAssetReference | undefined
): StatementControlPreview {
  const parameters = statementParameters(values, schema);
  const itemPreview = statementItemPreview(values, schema);
  const progressPreview = statementProgressPreview(values, schema);
  const animationPreview = statementAnimationPreview(values, schema, primaryAsset);
  const containerPreview = statementContainerPreview(values, schema);
  const assetLayers: DialogAssetLayer[] = [];

  if (itemPreview) {
    if (itemPreview.mode === 'empty-box') {
      if (primaryAsset) assetLayers.push({ role: 'background', assetRef: primaryAsset });
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
    if (primaryAsset) assetLayers.push({ role: 'background', assetRef: primaryAsset });
    const fill = progressAssetReference(values, schema, primaryAsset);
    if (fill) assetLayers.push({ role: 'progress', assetRef: fill });
  }

  if (containerPreview?.variant === 'list') {
    const scrollbar = listScrollbarAssetReference(values, schema);
    if (scrollbar) assetLayers.push({ role: 'scrollbar', assetRef: scrollbar });
  }
  assetLayers.push(...interactiveAssetReferences(values, schema));

  return {
    parameters,
    assetLayers: assetLayers.length > 0 ? assetLayers : undefined,
    itemPreview,
    progressPreview,
    animationPreview,
    containerPreview,
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
  const colorSuffix = /\/FCOLOR\s*=\s*(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d{1,3})\s*$/i.exec(content);
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

function tooltipLineRuns(value: string, inheritedColor?: string): Array<{ text: string; color?: string }> {
  let line = value;
  let color = inheritedColor;
  if (/^#\d{1,3}#/.test(line)) line = line.slice(1);
  const prefix = /^\s*(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d{1,3})#/.exec(line);
  if (prefix) {
    color = tooltipColor(prefix[1]);
    line = line.slice(prefix[0].length);
  }

  const runs: Array<{ text: string; color?: string }> = [];
  const inline = /\{([^{}]*?)\|(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d{1,3})\}|<([^<>]*?)\/FCOLOR\s*=\s*(\$[0-9A-F]{6}|#[0-9A-F]{6}|\d{1,3})>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(line)) !== null) {
    if (match.index > cursor) runs.push({ text: line.slice(cursor, match.index), ...(color ? { color } : {}) });
    runs.push({
      text: match[1] ?? match[3] ?? '',
      color: tooltipColor(match[2] ?? match[4]),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length || runs.length === 0) {
    runs.push({ text: line.slice(cursor), ...(color ? { color } : {}) });
  }
  return runs;
}

function tooltipColor(value: string): string {
  if (/^\d{1,3}$/.test(value)) return legendColor(Number(value));
  if (/^#[0-9A-F]{6}$/i.test(value)) return value;
  if (/^\$[0-9A-F]{6}$/i.test(value)) {
    const bgr = value.slice(1);
    return `#${bgr.slice(4, 6)}${bgr.slice(2, 4)}${bgr.slice(0, 2)}`;
  }
  return '#ffffff';
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
  if (!/(?:playimg|newui-frames|newui-effect)/i.test(schema.id)) return undefined;
  const frameCount = Math.max(1, primaryAsset?.frameCount || (
    schema.id === 'newui-effect-996pc'
      ? numericValue(keyedValue(values, 'num'))
      : undefined
  ) || 1);
  let intervalMs: number | undefined;
  let repeatCount: number | undefined;
  if (schema.syntax === 'key-value') {
    intervalMs = numericValue(keyedValue(values, 'speed'))
      ?? numericValue(keyedValue(values, 'gap'));
    repeatCount = numericValue(keyedValue(values, 'loop'))
      ?? numericValue(keyedValue(values, 'count'));
  } else {
    intervalMs = numericValue(positionalValue(values, 4));
    if (/playimgex/i.test(schema.id)) repeatCount = numericValue(positionalValue(values, 5));
    else if (/relative-996pc/i.test(schema.id)) repeatCount = numericValue(positionalValue(values, 8));
  }
  return {
    frameCount,
    intervalMs: Math.max(16, Math.min(60000, intervalMs || 100)),
    ...(repeatCount !== undefined ? { repeatCount } : {}),
  };
}

function listScrollbarAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogAssetReference | undefined {
  if (schema.id !== 'container-listview') return undefined;
  const willIndex = numericValue(positionalValue(values, 12));
  const imageIndex = numericValue(positionalValue(values, 13));
  return willIndex === undefined || imageIndex === undefined
    ? undefined
    : { willIndex, imageIndex };
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
    const linkIndex = parameters.length + 1;
    if (link && schema.parameterMeanings.has(linkIndex)) {
      parameters.push({
        index: linkIndex,
        name: schema.parameterMeanings.get(linkIndex)!,
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

function displayParameterValue(value: string): string {
  return value.trim().replace(/\s*\/@[^>]*$/, '').replace(/^['"]|['"]$/g, '');
}

function statementItemPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogItemPreview | undefined {
  switch (schema.id) {
    case 'item-show': {
      const itemIndex = numericValue(positionalValue(values, 1));
      const quantity = numericValue(positionalValue(values, 2));
      return {
        mode: 'database-index',
        itemIndex,
        quantity,
        frameValue: numericValue(positionalValue(values, 5)),
        label: itemIndex === undefined ? '动态物品 IDX' : `物品 IDX ${itemIndex}`,
      };
    }
    case 'newui-itemshow-996pc':
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
      const slot = numericValue(positionalValue(values, 1));
      const hero = schema.id === 'hero-user-item-preview';
      return {
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        frameValue: numericValue(positionalValue(values, 4)),
        label: `${hero ? '英雄' : '人物'}装备位 ${slot ?? '?'}`,
        message: '装备内容取决于游戏中的当前人物，只能静态预览物品框',
      };
    }
    case 'newui-equipshow-996pc':
    case 'newui-heroequipshow-996pc': {
      const slot = numericValue(keyedValue(values, 'index'));
      const hero = schema.id === 'newui-heroequipshow-996pc';
      return {
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        frameValue: numericValue(keyedValue(values, 'bgtype')),
        label: `${hero ? '英雄' : '人物'}装备位 ${slot ?? '?'}`,
        message: '装备内容取决于游戏中的当前人物，只能静态预览物品框',
      };
    }
    case 'newui-dbitemshow-996pc':
    case 'newui-herodbitemshow-996pc': {
      const uniqueIndex = numericValue(keyedValue(values, 'makeindex'));
      return {
        mode: 'unique-item',
        uniqueIndex,
        frameValue: numericValue(keyedValue(values, 'bgtype')),
        label: `唯一物品 ${uniqueIndex ?? '?'}`,
        message: '唯一物品由游戏运行时背包数据决定，只能静态预览物品框',
      };
    }
    case 'makeindex-item-preview': {
      const uniqueIndex = numericValue(positionalValue(values, 1));
      return {
        mode: 'unique-item',
        uniqueIndex,
        quantity: numericValue(positionalValue(values, 2)),
        frameValue: numericValue(positionalValue(values, 5)),
        label: `唯一物品 ${uniqueIndex ?? '?'}`,
        message: '唯一物品由游戏运行时数据决定，只能静态预览物品框',
      };
    }
    case 'custom-item-preview':
    case 'hero-custom-item-preview': {
      const slot = numericValue(positionalValue(values, 1));
      const hero = schema.id === 'hero-custom-item-preview';
      return {
        mode: hero ? 'hero-equipment' : 'equipment',
        equipmentSlot: slot,
        label: `${hero ? '英雄' : '人物'}自定义装备框 ${slot ?? '?'}`,
        message: '装备内容取决于游戏运行时数据，当前展示脚本指定的装备框底图',
      };
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
      const boxIndex = numericValue(positionalValue(values, 1));
      return {
        mode: 'empty-box',
        label: `OK框 ${boxIndex ?? '?'}`,
        message: 'OK框中的物品由玩家运行时放入',
      };
    }
    case 'newui-itembox-996pc': {
      const boxIndex = numericValue(keyedValue(values, 'boxindex'));
      return {
        mode: 'empty-box',
        label: `OK框 ${boxIndex ?? '?'}`,
        message: 'OK框中的物品由玩家运行时放入',
      };
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

function statementProgressPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogProgressPreview | undefined {
  let minimum: number;
  let maximum: number;
  let value: number;
  let direction: number;
  let offsetX: number;
  let offsetY: number;
  let text: string;

  if (schema.id === 'progress-bar') {
    minimum = numericValue(positionalValue(values, 10)) ?? 0;
    maximum = numericValue(positionalValue(values, 11)) ?? 100;
    value = numericValue(positionalValue(values, 12)) ?? minimum;
    direction = numericValue(positionalValue(values, 13)) ?? 0;
    offsetX = numericValue(positionalValue(values, 8)) ?? 0;
    offsetY = numericValue(positionalValue(values, 9)) ?? 0;
    text = cleanStaticValue(positionalValue(values, 17)) || '%p/%m';
  } else if (schema.id === 'newui-loadingbar-996pc') {
    minimum = 0;
    maximum = numericValue(keyedValue(values, 'maxper')) ?? 100;
    value = numericValue(keyedValue(values, 'startper')) ?? 0;
    direction = numericValue(keyedValue(values, 'direction')) ?? 0;
    offsetX = numericValue(keyedValue(values, 'offsetx')) ?? 0;
    offsetY = numericValue(keyedValue(values, 'offsety')) ?? 0;
    text = `${value}%`;
  } else {
    return undefined;
  }

  const denominator = maximum - minimum;
  const ratio = denominator > 0
    ? Math.max(0, Math.min(1, (value - minimum) / denominator))
    : 0;
  return { minimum, maximum, value, ratio, direction, offsetX, offsetY, text };
}

function progressAssetReference(
  values: ParsedStatementValues,
  schema: DialogStatementSchema,
  primaryAsset: DialogAssetReference | undefined
): DialogAssetReference | undefined {
  const image = schema.id === 'progress-bar'
    ? numericValue(positionalValue(values, 5))
    : schema.id === 'newui-loadingbar-996pc'
      ? numericValue(keyedValue(values, 'pcloadingbar'))
      : undefined;
  if (image === undefined) return undefined;
  if (primaryAsset) return { ...primaryAsset, imageIndex: image };
  if (schema.id === 'progress-bar') {
    const will = numericValue(positionalValue(values, 3));
    return will === undefined ? undefined : { willIndex: will, imageIndex: image };
  }
  const archiveName = cleanStaticValue(keyedValue(values, 'wil'));
  return archiveName ? { archiveName, imageIndex: image } : undefined;
}

function statementContainerPreview(
  values: ParsedStatementValues,
  schema: DialogStatementSchema
): DialogContainerPreview | undefined {
  const id = schema.id.toLowerCase();
  if (/newui-(?:hero)?(?:bagitems|equipitems)-996pc/.test(id)) {
    const cellCount = Math.max(1, numericValue(keyedValue(values, 'count')) ?? 12);
    const rows = Math.max(1, numericValue(keyedValue(values, 'row')) ?? 4);
    return {
      variant: 'item-grid',
      label: /hero/.test(id) ? '英雄物品列表' : '人物物品列表',
      cellCount,
      rows,
      columns: Math.max(1, Math.ceil(cellCount / rows)),
    };
  }
  if (!/(?:layout|listview|container-newline)/.test(id)) return undefined;
  if (id.includes('newline')) {
    return { variant: 'line-break', label: '容器换行' };
  }
  const isList = id.includes('listview');
  const colorValue = schema.syntax === 'key-value'
    ? cleanStaticValue(keyedValue(values, 'color'))
    : cleanStaticValue(positionalValue(values, isList ? undefined : 6));
  const colorNumber = colorValue === undefined ? undefined : Number(colorValue);
  return {
    variant: isList ? 'list' : 'layout',
    label: isList ? '列表容器' : '布局容器',
    borderColor: Number.isInteger(colorNumber) && colorNumber! >= 0
      ? legendColor(colorNumber!)
      : undefined,
  };
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
    case 'container': return { width: 220, height: 120 };
    case 'monster': return { width: 120, height: 160 };
    default: return { width: 120, height: 32 };
  }
}

function fallbackElementText(kind: DialogElementKind, raw: string): string {
  if (kind === 'input') return '输入框';
  if (kind === 'progress') return '进度条';
  if (kind === 'item') return '物品/装备';
  if (kind === 'container') return '容器';
  if (kind === 'monster') return '模型预览';
  return raw.slice(0, 42);
}

function statementColor(raw: string): string | undefined {
  const value = /(?:FCOLOR|COLOR)\s*=\s*([^;}|>]+)/i.exec(raw)?.[1]?.trim();
  if (!value) return undefined;
  if (/^\$[0-9A-F]{6}$/i.test(value)) return `#${value.slice(1)}`;
  if (/^#[0-9A-F]{6}$/i.test(value)) return value;
  const number = Number(value.split(',')[0]);
  if (!Number.isFinite(number)) return undefined;
  return legendColor(Math.trunc(number));
}

function legendColor(index: number): string {
  const palette: Record<number, string> = {
    7: '#d9d9d9', 31: '#ff6767', 58: '#ffb000', 70: '#80ff80',
    146: '#55ffff', 150: '#e5c07b', 151: '#ffffff', 246: '#fffbf0',
    249: '#ff0000',
    250: '#00ff00', 251: '#ffff00', 252: '#0000ff', 253: '#ff00ff',
    254: '#00ffff', 255: '#ffffff',
  };
  return palette[index] || '#ffffff';
}

function cleanDisplayText(value: string, multiline: boolean): string {
  const trimmed = value.trim();
  const pipe = multiline ? -1 : findTopLevelPipe(trimmed);
  let content = pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
  if (multiline) content = content.replace(/\|/g, '\n');
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
  width: number
): DialogElement {
  return {
    id: `${start}:flow-text`,
    statementId: 'flow-text',
    token: '<文字>',
    description: '传统 NPC 对话文字或动态输出',
    kind: 'text',
    raw: source.slice(start, end),
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
    color: statementColor(line.text),
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
  const byContainerId = new Map<string, DialogElement>();
  for (const element of elements) {
    if (!element.containerElementId) continue;
    if (byContainerId.has(element.containerElementId)) {
      warnings.push(`容器 ID ${element.containerElementId} 重复，已按首个元素建立父子关系`);
      continue;
    }
    byContainerId.set(element.containerElementId, element);
  }

  for (const parent of elements) {
    for (const childId of parent.containerChildIds || []) {
      const child = byContainerId.get(childId);
      if (!child || child === parent || child.parentElementId) continue;
      child.parentElementId = parent.id;
      child.containerParentId = parent.containerElementId || parent.id;
      if (child.coordinateMode === 'relative' && child.x && child.y) {
        child.x.displayValue -= offsets.memoX;
        child.y.displayValue -= offsets.memoY;
        child.localLayoutX = child.x.displayValue;
        child.localLayoutY = child.y.displayValue;
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
      warnings.push('检测到循环容器关系，相关控件保持局部坐标');
      return;
    }
    resolving.add(element.id);
    const parent = element.parentElementId
      ? byElementId.get(element.parentElementId)
      : undefined;
    if (parent) {
      resolve(parent);
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
}

function appendElementWarning(element: DialogElement, message: string): void {
  element.warning = element.warning ? `${element.warning}；${message}` : message;
}

function calculateCanvasSize(scenes: DialogScene[]): { width: number; height: number } {
  let width = 800;
  let height = 600;
  for (const scene of scenes) {
    for (const element of scene.elements) {
      width = Math.max(width, element.layoutX + Math.max(40, element.width) + 80);
      height = Math.max(height, element.layoutY + Math.max(24, element.height) + 80);
    }
  }
  return {
    width: Math.min(MAX_CANVAS_SIZE, Math.max(320, Math.ceil(width))),
    height: Math.min(MAX_CANVAS_SIZE, Math.max(240, Math.ceil(height))),
  };
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
  return value.trim().replace(/[>,)}\]]+$/, '');
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
