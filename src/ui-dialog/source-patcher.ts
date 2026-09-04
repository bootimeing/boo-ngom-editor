import * as path from 'path';
import {
  DialogCoordinateBinding,
  DialogCoordinateChange,
  NpcDialogDocumentModel,
  TextReplacement,
} from './model';

export interface BuildDialogEditsResult {
  replacements: TextReplacement[];
  changedElements: number;
}

export function buildDialogCoordinateEdits(
  currentText: string,
  model: NpcDialogDocumentModel,
  changes: readonly DialogCoordinateChange[]
): BuildDialogEditsResult {
  const elements = new Map(
    model.scenes.flatMap(scene => scene.elements).map(element => [element.id, element])
  );
  const coordinateBindings = collectCoordinateBindings(model);
  const requested = new Map(changes.map(change => [change.elementId, {
    x: normalizeCoordinate(change.x),
    y: normalizeCoordinate(change.y),
  }]));
  const replacements: TextReplacement[] = [];
  const touchedElements = new Set<string>();

  for (const change of changes) {
    const element = elements.get(change.elementId);
    const binding = coordinateBindings.get(change.elementId);
    if (!element && !binding) throw new Error(`界面元素已变化，请重新载入: ${change.elementId}`);
    if (binding) {
      if (isExternalSource(model, binding.sourceFilePath, binding.sourceUri)) {
        throw new Error(`${binding.targetKind} 来自外部 QFunction companion，当前为只读预览，不能写入主 NPC 文件`);
      }
      if (!binding.editable) {
        throw new Error(`${binding.targetKind} 的坐标不是可安全修改的直接数值`);
      }
      const display = requested.get(change.elementId)!;
      addReplacement(currentText, replacements, binding.id, 'x', binding.x.span, display.x);
      addReplacement(currentText, replacements, binding.id, 'y', binding.y.span, display.y);
      if (display.x !== binding.x.sourceValue || display.y !== binding.y.sourceValue) {
        touchedElements.add(binding.id);
      }
      continue;
    }
    if (!element) throw new Error(`界面元素已变化，请重新载入: ${change.elementId}`);
    if (isExternalElement(model, element)) {
      throw new Error(`${element.token} 来自外部 QFunction companion，当前为只读预览，不能写入主 NPC 文件`);
    }
    if (!element.editable || !element.x || !element.y) {
      throw new Error(`${element.token} 的坐标不是可安全修改的直接数值`);
    }
    const display = requested.get(change.elementId)!;
    const parentDisplay = element.parentElementId
      ? requestedElementPosition(element.parentElementId, elements, requested, new Set())
      : undefined;
    const localDisplayX = display.x - (parentDisplay?.x || 0);
    const localDisplayY = display.y - (parentDisplay?.y || 0);
    const relative = element.coordinateMode === 'relative' && !element.parentElementId;
    const sourceX = localDisplayX
      - (relative ? model.offsets.memoX : 0)
      + element.sourceCoordinateBiasX;
    const sourceY = localDisplayY
      - (relative ? model.offsets.memoY : 0)
      + element.sourceCoordinateBiasY;
    addReplacement(currentText, replacements, element.id, 'x', element.x.span, sourceX);
    addReplacement(currentText, replacements, element.id, 'y', element.y.span, sourceY);
    if (sourceX !== element.x.sourceValue || sourceY !== element.y.sourceValue) {
      touchedElements.add(element.id);
    }
  }

  const unique = new Map<string, TextReplacement>();
  for (const replacement of replacements) {
    const key = `${replacement.start}:${replacement.end}`;
    const existing = unique.get(key);
    if (existing && existing.text !== replacement.text) {
      throw new Error('多个场景共享同一坐标，但提交值不一致');
    }
    unique.set(key, replacement);
  }
  const ordered = [...unique.values()].sort((left, right) => right.start - left.start);
  assertNoOverlaps(ordered);
  return { replacements: ordered, changedElements: touchedElements.size };
}

function collectCoordinateBindings(
  model: NpcDialogDocumentModel
): Map<string, DialogCoordinateBinding> {
  const bindings = new Map<string, DialogCoordinateBinding>();
  const add = (binding: DialogCoordinateBinding | undefined): void => {
    if (binding) bindings.set(binding.id, binding);
  };
  for (const window of model.addDlgWindows) {
    add(window.windowOriginBinding);
    add(window.contentOriginBinding);
  }
  for (const scene of model.scenes) add(scene.background?.offsetBinding);
  return bindings;
}

function isExternalElement(
  model: NpcDialogDocumentModel,
  element: NpcDialogDocumentModel['scenes'][number]['elements'][number]
): boolean {
  return isExternalSource(model, element.sourceFilePath, element.sourceUri);
}

function isExternalSource(
  model: NpcDialogDocumentModel,
  sourceFilePath: string | undefined,
  sourceUri: string | undefined
): boolean {
  const pathMismatch = Boolean(sourceFilePath
    && path.resolve(sourceFilePath).toLowerCase() !== path.resolve(model.filePath).toLowerCase());
  const uriMismatch = Boolean(sourceUri
    && sourceUri.replace(/\\/g, '/').toLowerCase()
      !== model.uri.replace(/\\/g, '/').toLowerCase());
  return pathMismatch || uriMismatch;
}

function requestedElementPosition(
  elementId: string,
  elements: ReadonlyMap<string, NpcDialogDocumentModel['scenes'][number]['elements'][number]>,
  requested: ReadonlyMap<string, { x: number; y: number }>,
  resolving: Set<string>
): { x: number; y: number } {
  const direct = requested.get(elementId);
  if (direct) return direct;
  const element = elements.get(elementId);
  if (!element) throw new Error(`父容器已变化，请重新载入: ${elementId}`);
  if (resolving.has(elementId)) throw new Error('容器父子关系存在循环，无法安全保存坐标');
  resolving.add(elementId);
  const parent = element.parentElementId
    ? requestedElementPosition(element.parentElementId, elements, requested, resolving)
    : undefined;
  resolving.delete(elementId);
  return {
    x: (parent?.x || 0) + element.localLayoutX,
    y: (parent?.y || 0) + element.localLayoutY,
  };
}

export function applyTextReplacements(
  source: string,
  replacements: readonly TextReplacement[]
): string {
  let result = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}

function addReplacement(
  currentText: string,
  target: TextReplacement[],
  elementId: string,
  axis: 'x' | 'y',
  span: { start: number; end: number; original: string },
  nextValue: number
): void {
  const current = currentText.slice(span.start, span.end);
  if (current !== span.original) {
    throw new Error(`源码中的 ${axis.toUpperCase()} 坐标已被修改，请重新载入后再保存`);
  }
  if (Number(span.original) === nextValue) return;
  const text = String(nextValue);
  if (text === span.original) return;
  target.push({ start: span.start, end: span.end, text, elementId, axis });
}

function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) throw new Error('坐标必须是有效数字');
  const integer = Math.round(value);
  if (Math.abs(integer) > 1_000_000) throw new Error('坐标超出允许范围');
  return integer;
}

function assertNoOverlaps(replacements: readonly TextReplacement[]): void {
  for (let index = 1; index < replacements.length; index++) {
    const previous = replacements[index - 1];
    const current = replacements[index];
    if (current.end > previous.start) throw new Error('坐标替换范围发生重叠，已停止保存');
  }
}
