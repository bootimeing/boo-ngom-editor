import { AddDlgCompanionResolution, parseNpcDialogDocumentWithCompanion } from './adddlg-companion';
import { DialogCoordinateBinding, DialogElement, NpcDialogDocumentModel, SourceSpan } from './model';
import { ParseNpcDialogOptions } from './source-parser';
import { buildPreviewScriptProgram } from './preview-script-program';
import { PreviewScriptSource, PreviewScriptSourcePurpose, PreviewScriptSourceResolution } from './preview-script-source';

type Program = ReturnType<typeof buildPreviewScriptProgram>;
type SourceResolver = (rawPath: string, purpose?: PreviewScriptSourcePurpose) => PreviewScriptSourceResolution;
interface ExecutionLocation { sourceRange: SourceSpan; lineNumber: number; text: string }
interface ProgramState {
  program: Program;
  execution: Map<string, ExecutionLocation>;
  coordinates: DialogProgramCoordinateAuthority;
  events: ReadonlyMap<string, DialogProgramEventAuthority>;
}
export interface DialogProgramEventAuthority {
  /** Source-owned contracts and call-site identity captured before publication. */
  element: DialogElement;
  pageElements: readonly DialogElement[];
  source: PreviewScriptSource;
  sourceLabel: string;
  execution: ExecutionLocation;
  sourceRootLabel?: string;
}
export interface DialogProgramCoordinateAuthority {
  /** Immutable host-only copies; no source text or capability map is serialized. */
  primary: PreviewScriptSource;
  model: NpcDialogDocumentModel;
  targets: Readonly<Record<string, PreviewScriptSource>>;
}
// Physical text and execution offsets never leave the host. A Webview element
// identity can select an entry, but cannot manufacture its source or call frame.
const programs = new WeakMap<NpcDialogDocumentModel, ProgramState>();

function sourceAt(program: Program, start: number, end: number): { source: PreviewScriptSource; start: number; end: number; constantExpansion?: boolean } | undefined {
  let low = 0, high = program.segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (program.segments[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  if (start === end) {
    const point = program.segments[low] || program.segments[low - 1];
    if (!point || point.rewritten || start < point.start || start > point.end) return undefined;
    return {source:point.source, start:point.sourceStart + start - point.start, end:point.sourceStart + start - point.start};
  }
  const pieces = [];
  for (let index = low; index < program.segments.length && program.segments[index].start < end; index++) pieces.push(program.segments[index]);
  if (!pieces.length || pieces[0].start > start || pieces[pieces.length - 1].end < end) return undefined;
  const first = pieces[0];
  const expanded = (piece: Program['segments'][number]) => piece.constantExpansion?.status === 'resolved';
  if (pieces.some(piece => (piece.rewritten && !expanded(piece)) || piece.source.uri !== first.source.uri
    || (!expanded(piece) && piece.end - piece.start !== piece.sourceEnd - piece.sourceStart))) return undefined;
  for (let index = 1; index < pieces.length; index++) {
    if (pieces[index - 1].end !== pieces[index].start || pieces[index - 1].sourceEnd !== pieces[index].sourceStart) return undefined;
  }
  const last = pieces[pieces.length - 1];
  // A generated fragment can be located at its complete original use, but cannot
  // inherit a reversible numeric span from the declaration or its expanded value.
  return { source: first.source, start: expanded(first) ? first.sourceStart : first.sourceStart + start - first.start,
    end: expanded(last) ? last.sourceEnd : last.sourceStart + end - last.start,
    ...(pieces.some(expanded) ? {constantExpansion:true} : {}) };
}

function spanLike(value: unknown): value is SourceSpan {
  const item = value as SourceSpan | undefined;
  return Boolean(item && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && typeof item.original === 'string');
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as object).forEach(child => freezeDeep(child));
    Object.freeze(value);
  }
  return value;
}

function directSpan(source: PreviewScriptSource, span: SourceSpan | undefined): boolean {
  return Boolean(span && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
    && span.start >= 0 && span.end > span.start && span.end <= source.text.length
    && source.text.slice(span.start, span.end) === span.original
    && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(span.original.trim()) && Number.isFinite(Number(span.original)));
}

function snapshotCoordinateAuthority(model: NpcDialogDocumentModel, primary: PreviewScriptSource,
  mapped: ReadonlyMap<object, PreviewScriptSource>): DialogProgramCoordinateAuthority {
  const sources = new Map<string, PreviewScriptSource>();
  const snapshot = (source: PreviewScriptSource) => {
    let result = sources.get(source.uri);
    if (!result) { result = Object.freeze({...source}); sources.set(source.uri, result); }
    return result;
  };
  const targets: Record<string, PreviewScriptSource> = Object.create(null);
  const elements = new Map(model.scenes.flatMap(scene => scene.elements).map(element => [element.id, element]));
  const eligible = (element: DialogElement, visiting: Set<string>): boolean => {
    const source = mapped.get(element);
    if (!source || !element.editable || !element.x || !element.y
      || mapped.get(element.sourceRange)?.uri !== source.uri
      || mapped.get(element.x.span)?.uri !== source.uri || mapped.get(element.y.span)?.uri !== source.uri
      || !directSpan(source, element.x.span) || !directSpan(source, element.y.span)
      || element.x.sourceValue !== Number(element.x.span.original) || element.y.sourceValue !== Number(element.y.span.original)) return false;
    if (visiting.has(element.id)) return false;
    if (element.parentElementId) {
      const parent = elements.get(element.parentElementId);
      if (!parent || mapped.get(parent)?.uri !== source.uri) return false;
      // External child offsets may depend only on same-source direct parent geometry.
      // A percentage/flow/anchor parent's hydrated size must not silently alter writeback.
      if (source.uri !== primary.uri) {
        visiting.add(element.id);
        if (!eligible(parent, visiting)) return false;
        visiting.delete(element.id);
      }
    }
    return true;
  };
  for (const element of elements.values()) {
    const source = mapped.get(element);
    if (eligible(element, new Set())) targets[element.id] = snapshot(source!);
    else if (source?.uri !== primary.uri) element.editable = false;
  }
  const addBinding = (binding?: DialogCoordinateBinding) => {
    const source = binding && mapped.get(binding);
    // AddDlg/QFunction and external document-level bindings remain read-only this pass.
    if (binding && source?.uri === primary.uri && binding.editable
      && mapped.get(binding.sourceRange)?.uri === source.uri
      && mapped.get(binding.x.span)?.uri === source.uri && mapped.get(binding.y.span)?.uri === source.uri
      && directSpan(source, binding.x.span) && directSpan(source, binding.y.span)) targets[binding.id] = snapshot(source);
  };
  for (const scene of model.scenes) addBinding(scene.background?.offsetBinding);
  for (const window of model.addDlgWindows) { addBinding(window.windowOriginBinding); addBinding(window.contentOriginBinding); }
  const copy: NpcDialogDocumentModel = JSON.parse(JSON.stringify({...model, pages: [], actUiPreviews: [], previewInputs: [], previewNavigation: undefined}));
  return freezeDeep({primary: snapshot(primary), model: copy, targets});
}

export function parseNpcDialogScriptProgram(
  primary: PreviewScriptSource,
  options: ParseNpcDialogOptions,
  companion: AddDlgCompanionResolution,
  resolve: SourceResolver
): NpcDialogDocumentModel {
  const program = buildPreviewScriptProgram(primary, options.engine, resolve);
  const cursor = program.segments.find(segment => segment.source.uri === primary.uri
    && options.cursorOffset >= segment.sourceStart && options.cursorOffset < segment.sourceEnd)
    || (options.cursorOffset === primary.text.length ? [...program.segments].reverse().find(segment => segment.source.uri === primary.uri
      && segment.sourceEnd === options.cursorOffset && segment.sourceEnd > segment.sourceStart) : undefined);
  const model = parseNpcDialogDocumentWithCompanion(program.text, {
    ...options, cursorOffset: cursor ? cursor.start + (cursor.rewritten ? 0 : options.cursorOffset - cursor.sourceStart) : options.cursorOffset,
    addDlgLocalLabels: [...primary.text.matchAll(/^\uFEFF?\s*\[(@[^\]\r\n]+)\]/gm)].map(match => match[1]),
  }, companion);
  const execution = new Map<string, ExecutionLocation>();
  const elements = new Set(model.scenes.flatMap(scene => scene.elements));
  for (const element of elements) {
    // AddDlg's separately parsed companion already has physical offsets.
    if (element.sourceUri && element.sourceUri !== primary.uri) continue;
    execution.set(element.id, {sourceRange: {...element.sourceRange}, lineNumber: element.lineNumber, text: program.text});
  }
  const visited = new WeakMap<object, boolean>();
  const mapped = new Map<object, PreviewScriptSource>();
  const remap = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return true;
    if (visited.has(value)) return visited.get(value)!;
    visited.set(value, true);
    const item = value as Record<string, any>;
    if (item.sourceUri && item.sourceUri !== primary.uri) return true;
    if (spanLike(item)) {
      const origin = sourceAt(program, item.start, item.end);
      if (!origin || (!origin.constantExpansion && origin.source.text.slice(origin.start, origin.end) !== item.original)) { visited.set(value, false); return false; }
      mapped.set(value as object, origin.source);
      if (origin.constantExpansion) item.original = origin.source.text.slice(origin.start, origin.end);
      item.start = origin.start; item.end = origin.end;
      return true;
    }
    const originalRange = spanLike(item.sourceRange) ? {...item.sourceRange} : undefined;
    const origin = originalRange && sourceAt(program, originalRange.start, originalRange.end);
    let complete = true;
    for (const child of Object.values(item)) if (!remap(child)) complete = false;
    if (originalRange) {
      if (!origin) complete = false;
      else {
        item.sourceUri = origin.source.uri;
        item.sourceFilePath = origin.source.filePath;
        item.sourceDocumentVersion = origin.source.documentVersion;
        if (typeof item.lineNumber === 'number') item.lineNumber = origin.source.text.slice(0, origin.start).split(/\r\n|\n|\r/).length;
        if (origin.constantExpansion && item.x?.span && item.y?.span && typeof item.editable === 'boolean'
          && (!directSpan(origin.source, item.x.span) || !directSpan(origin.source, item.y.span))) {
          item.editable = false;
          item.warning = [item.warning, '常量生成的坐标按原宏使用处定位，不反向改写定义；直接数字坐标仍可编辑'].filter(Boolean).join('；');
        }
        if (origin.source.uri !== primary.uri && typeof item.editable === 'boolean') {
          if (item.token) {
            item.warning = [item.warning, '外部 CALL 直接坐标按原文档写回；客户端动作仍为本地预览边界'].filter(Boolean).join('；');
          } else item.editable = false;
        }
        if (complete) mapped.set(value as object, origin.source);
      }
    }
    if (!complete && typeof item.editable === 'boolean') item.editable = false;
    visited.set(value, complete);
    return complete;
  };
  // Do not walk the entire model: preview-navigation line numbers belong to the
  // virtual execution program, not the physical source map.
  for (const element of elements) remap(element);
  for (const scene of model.scenes) { remap(scene.background); remap(scene.addDlgWindow); }
  for (const window of model.addDlgWindows) remap(window);
  for (const card of model.actUiPreviews) remap(card);
  const roots = program.segments.filter(segment => segment.source.uri === primary.uri);
  const point = (offset: number) => {
    const segment = roots.find(part => offset >= part.start && offset < part.end) || roots.find(part => offset === part.end);
    return segment ? segment.sourceStart + Math.min(offset - segment.start, segment.sourceEnd - segment.sourceStart) : primary.text.length;
  };
  model.functionStart = point(model.functionStart);
  model.functionEnd = point(model.functionEnd);
  const resolutions = [...program.sources.values()].map(entry => entry.resolution);
  const found = resolutions.flatMap(result => result.status === 'found' ? [result.source] : []);
  model.companionUris = [...new Set([...model.companionUris, ...found.map(source => source.uri)])];
  model.companionFilePaths = [...new Set([...model.companionFilePaths, ...found.map(source => source.filePath)])];
  model.companionCandidateFilePaths = [...new Set([...model.companionCandidateFilePaths,
    ...resolutions.flatMap(result => result.candidateFilePaths)])];
  model.scriptSourceCandidateFilePaths = [...new Set(resolutions.flatMap(result => result.candidateFilePaths))];
  model.warnings.push(...program.warnings);
  const events = snapshotEventAuthority(model, program, execution, mapped);
  const coordinates = snapshotCoordinateAuthority(model, primary, mapped);
  programs.set(model, {program, execution, coordinates, events});
  return model;
}

export function dialogProgramExecutionLocation(model: NpcDialogDocumentModel, element: DialogElement): ExecutionLocation | undefined {
  return programs.get(model)?.execution.get(element.id);
}

function snapshotEventAuthority(model: NpcDialogDocumentModel, program: Program,
  execution: ReadonlyMap<string, ExecutionLocation>, mapped: ReadonlyMap<object, PreviewScriptSource>): ReadonlyMap<string, DialogProgramEventAuthority> {
  const events = new Map<string, DialogProgramEventAuthority>();
  const duplicateIds = new Set<string>();
  for (const page of model.pages) {
    if (page.executionPreview) continue;
    let pageElements: readonly DialogElement[] | undefined;
    for (const element of page.elements) {
      const source = mapped.get(element), location = execution.get(element.id);
      const capable = element.localParameterTarget || element.localDoubleClickTarget || element.localControlTarget
        || element.localCompletionTarget || element.localPopupInput;
      if (!capable) continue;
      // A physical source map is necessary but insufficient: imported events
      // additionally require an emitted instance rooted in the explicit path.
      const complete = source && location && mapped.get(element.sourceRange)?.uri === source.uri
        && source.text.slice(element.sourceRange.start, element.sourceRange.end) === element.sourceRange.original
        && eventSourceUnchanged(element, location)
        && (source.uri === program.primary.uri || (Number.isSafeInteger(element.sayOccurrence)
          && element.sayOccurrence! >= 0 && Boolean(element.executionRootLabel)));
      if (!complete) {
        delete element.localParameterTarget; delete element.localDoubleClickTarget;
        delete element.localControlTarget; delete element.localCompletionTarget; delete element.localPopupInput;
        continue;
      }
      if (events.has(element.id)) { duplicateIds.add(element.id); continue; }
      pageElements ||= freezeDeep(JSON.parse(JSON.stringify(page.elements)) as DialogElement[]);
      const frozenElement = pageElements.find(item => item.id === element.id)!;
      events.set(element.id, freezeDeep({element: frozenElement, pageElements, source: {...source}, sourceLabel: page.sourceLabel,
        execution: {...location, sourceRange: {...location.sourceRange}}, sourceRootLabel: element.executionRootLabel}));
    }
  }
  for (const id of duplicateIds) events.delete(id);
  return events;
}

function eventSourceUnchanged(element: DialogElement, location: ExecutionLocation): boolean {
  const physical = element.sourceRange.original;
  const virtual = location.text.slice(location.sourceRange.start, location.sourceRange.end);
  const macro = /\(\$[^()\r\n]+\)|\$\([^()\r\n]+\)/;
  if (element.statementId === 'text-link' || element.statementId === 'text-link-params') {
    const originalAction = physical.indexOf('/@'), expandedAction = virtual.indexOf('/@');
    if (originalAction < 0 || expandedAction < 0 || physical.split('/@').length !== 2 || virtual.split('/@').length !== 2) return false;
    // A caption-only constant may change display text, never the action suffix.
    // Unexpanded/unknown action macros cannot masquerade as literal parameters.
    const suffix = physical.slice(originalAction);
    return !macro.test(suffix) && suffix === virtual.slice(expandedAction);
  }
  return !macro.test(physical) && virtual === physical;
}

/** Only an original host model has event authority; a serialized clone cannot grant it. */
export function dialogProgramEventAuthority(model: NpcDialogDocumentModel, elementId: string): DialogProgramEventAuthority | undefined {
  return programs.get(model)?.events.get(elementId);
}

/** Distinguish a legacy same-file model from a program model missing event authority. */
export function hasDialogProgramAuthority(model: NpcDialogDocumentModel): boolean {
  return programs.has(model);
}

/** Re-read every dependency, including missing/ambiguous candidate sets. */
export function dialogProgramSourcesCurrent(model: NpcDialogDocumentModel, resolve: SourceResolver): boolean {
  const state = programs.get(model);
  if (!state) return true;
  for (const {rawPath, purpose, resolution: before} of state.program.sources.values()) {
    const after = resolve(rawPath, purpose);
    if (before.status !== after.status || JSON.stringify(before.candidateFilePaths) !== JSON.stringify(after.candidateFilePaths)) return false;
    if (before.status === 'found') {
      if (after.status !== 'found' || before.source.uri !== after.source.uri
        || (before.source.documentVersion > 0 && after.source.documentVersion > 0 && before.source.documentVersion !== after.source.documentVersion)
        || before.source.text !== after.source.text
        || (before.source.sha256 && after.source.sha256 && before.source.sha256 !== after.source.sha256)) return false;
    }
  }
  return true;
}

export function dialogProgramSource(model: NpcDialogDocumentModel, uri: string): PreviewScriptSource | undefined {
  const program = programs.get(model)?.program;
  if (!program) return undefined;
  if (program.primary.uri === uri) return program.primary;
  for (const {resolution: result} of program.sources.values()) if (result.status === 'found' && result.source.uri === uri) return result.source;
  return undefined;
}

/** Host-only write capabilities from the actual parse, never from a Webview model clone. */
export function dialogProgramCoordinateAuthority(model: NpcDialogDocumentModel): DialogProgramCoordinateAuthority | undefined {
  return programs.get(model)?.coordinates;
}

/** Called only by the host after production hydration/reflow, before publishing. */
export function refreshDialogProgramCoordinateLayout(model: NpcDialogDocumentModel): void {
  const state = programs.get(model);
  if (!state) return;
  const live = new Map(model.scenes.flatMap(scene => scene.elements).map(element => [element.id, element]));
  const copy: NpcDialogDocumentModel = JSON.parse(JSON.stringify(state.coordinates.model));
  const fields = ['localLayoutX', 'localLayoutY', 'layoutX', 'layoutY'] as const;
  for (const element of copy.scenes.flatMap(scene => scene.elements)) {
    const current = live.get(element.id);
    if (!current) throw new Error('坐标布局发布缺少已映射元素，请重新载入');
    for (const field of fields) {
      if (!Number.isFinite(current[field]) || Math.abs(current[field]) > 10_000_000) throw new Error('坐标布局发布包含无效位置');
      element[field] = current[field];
    }
  }
  // Never copy editable, parent IDs, biases, URI/path, source text or source spans.
  // The explicit host refresh updates geometry, not write authority.
  state.coordinates = freezeDeep({...state.coordinates, model: copy});
}
