import { DialogCoordinateBinding, DialogCoordinateChange, DialogElement, NpcDialogDocumentModel, TextReplacement } from './model';
import { dialogProgramCoordinateAuthority } from './preview-script-model';
import { PreviewScriptSource } from './preview-script-source';
import { buildDialogCoordinateEdits } from './source-patcher';

export interface DialogProgramCoordinateEditPlan {
  source: PreviewScriptSource;
  replacements: TextReplacement[];
  changedElements: number;
}

function assertSharedCoordinateIntent(source: PreviewScriptSource, model: NpcDialogDocumentModel,
  changes: readonly DialogCoordinateChange[]): void {
  const elements = new Map(model.scenes.flatMap(scene => scene.elements).map(element => [element.id, element]));
  const targets = new Map<string, DialogElement | DialogCoordinateBinding>(elements);
  for (const scene of model.scenes) if (scene.background?.offsetBinding) targets.set(scene.background.offsetBinding.id, scene.background.offsetBinding);
  for (const window of model.addDlgWindows) for (const binding of [window.windowOriginBinding, window.contentOriginBinding]) if (binding) targets.set(binding.id, binding);
  const slots = new Map<string, Set<string>>();
  for (const change of changes) {
    const target = targets.get(change.elementId);
    for (const coordinate of [target?.x, target?.y]) if (coordinate) {
      const key = `${coordinate.span.start}:${coordinate.span.end}`;
      const ids = slots.get(key) || new Set<string>(); ids.add(change.elementId); slots.set(key, ids);
    }
  }
  const shared = new Set([...slots].filter(([, ids]) => ids.size > 1).flatMap(([, ids]) => [...ids]));
  if (!shared.size) return;
  const requested = new Map(changes.map(change => [change.elementId, change]));
  const intent = new Map<string, number>();
  for (const change of changes) if (shared.has(change.elementId)) {
    const ancestors: DialogCoordinateChange[] = [];
    const visited = new Set<string>();
    let parentId = elements.get(change.elementId)?.parentElementId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error('容器父子关系存在循环，无法安全保存坐标');
      visited.add(parentId);
      const parentChange = requested.get(parentId); if (parentChange) ancestors.push(parentChange);
      parentId = elements.get(parentId)?.parentElementId;
    }
    const result = buildDialogCoordinateEdits(source.text, model, [...ancestors, change]);
    const target = targets.get(change.elementId)!;
    for (const coordinate of [target.x, target.y]) if (coordinate) {
      const key = `${coordinate.span.start}:${coordinate.span.end}`;
      if ((slots.get(key)?.size || 0) < 2) continue;
      const replacement = result.replacements.find(item => item.start === coordinate.span.start && item.end === coordinate.span.end);
      const next = replacement ? Number(replacement.text) : Number(coordinate.span.original);
      const before = intent.get(key);
      if (before !== undefined && before !== next) throw new Error('多个场景共享同一坐标，但提交值不一致（包括无修改的实例）');
      intent.set(key, next);
    }
  }
}

/** Produce per-physical-document plans. Only the Provider may validate and apply them. */
export function buildDialogProgramCoordinateEdits(
  currentPrimaryText: string,
  model: NpcDialogDocumentModel,
  changes: readonly DialogCoordinateChange[]
): DialogProgramCoordinateEditPlan[] {
  const authority = dialogProgramCoordinateAuthority(model);
  if (!authority) throw new Error('坐标写回缺少本次已发布的源码能力，请重新载入');
  if (currentPrimaryText !== authority.primary.text) throw new Error('主源码已被修改，请重新载入后再保存');
  if (!Array.isArray(changes) || changes.length > 4096) throw new Error('坐标变更数量无效或超过上限');
  const groups = new Map<string, {source: PreviewScriptSource; changes: DialogCoordinateChange[]}>();
  const duplicateIds = new Map<string, DialogCoordinateChange>();
  for (const change of changes) {
    if (!change || typeof change.elementId !== 'string' || typeof change.x !== 'number' || typeof change.y !== 'number') {
      throw new Error('坐标变更格式无效');
    }
    const source = authority.targets[change.elementId];
    if (!source) throw new Error('元素没有可安全写回的原始坐标能力（动态坐标、QFunction、来源未映射或父布局不确定）：' + change.elementId);
    const previous = duplicateIds.get(change.elementId);
    if (previous && (previous.x !== change.x || previous.y !== change.y)) throw new Error('同一元素提交了不同的坐标');
    if (previous) continue;
    duplicateIds.set(change.elementId, change);
    let group = groups.get(source.uri);
    if (!group) { group = {source, changes: []}; groups.set(source.uri, group); }
    group.changes.push({...change});
  }
  const plans: DialogProgramCoordinateEditPlan[] = [];
  for (const group of groups.values()) {
    // The existing patcher still independently rejects any mismatched URI/path.
    // Its input is the frozen host snapshot and this group's real source identity,
    // never mutable source fields supplied on the currently displayed element.
    const perSource = {...authority.model, uri: group.source.uri, filePath: group.source.filePath,
      fileName: group.source.fileName, documentVersion: group.source.documentVersion};
    assertSharedCoordinateIntent(group.source, perSource, group.changes);
    const result = buildDialogCoordinateEdits(group.source.text, perSource, group.changes);
    if (result.replacements.length) plans.push({source: group.source, ...result});
  }
  return plans;
}
