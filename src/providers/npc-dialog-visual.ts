import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadStaticLanguageData } from '../data/loader';
import {
  cachedPatchImageUri,
  webviewResourceRoots,
} from '../utils/archive-resource-provider';
import {
  clientResourceLayoutFromState,
  scanClientArchiveFiles,
} from '../utils/client-resources';
import { getEngineDefinition, normalizeEngineId } from '../utils/engine-registry';
import { findMir200Directory } from '../utils/map-entities';
import { loadPakIndex } from '../utils/pak';
import {
  findCachedPatchImage,
  loadCachedPatchAssetTable,
  patchImagePath,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  resolveCachedPatchArchiveByName,
  validatePatchCacheMd5,
  CachedPatchAssetTable,
  CachedPatchPak,
  SavedPatchManagerState,
} from '../utils/patch-cache';
import { getPatchCacheRoot } from '../utils/cache-storage';
import { decodeTextFile } from '../utils/text';
import { ScriptDataResolver } from '../utils/script-data-resolver';
import {
  resolveItemImageReferenceForSource,
} from '../utils/item-image';
import {
  configuredGameUiPackArchive,
  uiEditorArchiveExtensions,
} from '../utils/ui-archive';
import { secureWebviewHtml } from '../utils/webview-security';
import { EngineId } from '../types';
import {
  DialogAssetPreview,
  DialogAssetReference,
  DialogBackground,
  DialogCoordinateChange,
  DialogElement,
  DialogItemPreview,
  NpcDialogDocumentModel,
  NpcDialogOffsets,
} from '../ui-dialog/model';
import { parseNpcDialogOffsets, workspaceNpcDialogOffsets } from '../ui-dialog/offsets';
import { sequentialFrameAssetReferences } from '../ui-dialog/progress-preview';
import {
  buildDialogItemTooltip,
  DialogItemDatabaseFields,
} from '../ui-dialog/item-tooltip';
import { buildDialogCoordinateEdits } from '../ui-dialog/source-patcher';
import { reflowNpcDialogLayout } from '../ui-dialog/source-parser';
import {
  AddDlgCompanionResolution,
  dialogCompanionSourceChangeAction,
  dialogElementSource,
  isDialogCompanionModelSource,
  parseNpcDialogDocumentWithCompanion,
  resolveAddDlgCompanion,
} from '../ui-dialog/adddlg-companion';
import { buildDialogStatementCatalog } from '../ui-dialog/statement-catalog';

const DIALOG_ITEM_TOOLTIP_DATABASE_FIELDS = [
  'Name', 'StdMode', 'Shape', 'Weight', 'Looks', 'DuraMax',
] as const;

type DialogItemTooltipFieldResolver = (
  itemIndex: number,
  field: typeof DIALOG_ITEM_TOOLTIP_DATABASE_FIELDS[number]
) => string | undefined;

interface DialogAssetResolutionSnapshot {
  cacheRoot: string;
  resourceRoots: readonly string[];
  archiveFiles: readonly string[];
  previewPaks: Map<DialogAssetPreview, CachedPatchPak>;
}

/**
 * Hydrate a background only when its two resource fields survived independently
 * as static integers. Runtime and geometry diagnostics (movable, close state,
 * offsets or nine-grid size) do not change which source image was requested.
 * Rebuild the reference from typed scalar fields so a stale serialized assetRef
 * cannot turn a dynamic MOV preview into a workspace resource request.
 */
export function hydrateDialogBackgroundAssets(
  model: { scenes: Array<{ background?: DialogBackground }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  for (const scene of model.scenes || []) {
    const background = scene.background;
    if (!background) continue;
    delete background.asset;
    delete background.assetRef;
    const diagnosedFields = [
      ...(background.dynamicFields || []),
      ...(background.invalidFields || []),
    ];
    if (
      diagnosedFields.includes('will-index')
      || diagnosedFields.includes('image-index')
      || (background.status !== 'static' && diagnosedFields.length === 0)
    ) continue;
    const reference: DialogAssetReference = {
      willIndex: background.willIndex as number,
      imageIndex: background.imageIndex as number,
    };
    if (
      !Number.isInteger(reference.willIndex)
      || reference.willIndex! < 0
      || !Number.isInteger(reference.imageIndex)
      || reference.imageIndex! < 0
    ) continue;
    background.assetRef = reference;
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    const asset = cache.get(key);
    if (asset) background.asset = asset;
  }
}

/**
 * Resolve every statically proven ADDBUTTON visual layer while preserving
 * effect-frame time slots. Dynamic, invalid and evidence-blocked previews are
 * hard-gated here as well as in the parser so stale serialized references can
 * never escape into workspace/cache lookups.
 */
export function hydrateAddButtonAssets(
  model: { scenes: Array<{ elements: DialogElement[] }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  const hydrate = (reference: DialogAssetReference): DialogAssetPreview | undefined => {
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    return cache.get(key);
  };
  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const preview = element.addButtonPreview;
      if (!preview) continue;
      delete element.asset;
      for (const layer of element.assetLayers || []) delete layer.asset;
      for (const effect of preview.effects || []) delete effect.frames;
      const blocked = preview.status === 'dynamic'
        || preview.status === 'invalid'
        || preview.status === 'evidence-blocked'
        || preview.dynamicFields.length > 0
        || preview.invalidFields.length > 0;
      if (blocked) {
        element.assetLayers = undefined;
        continue;
      }

      if (isHydratableDialogAssetReference(element.assetRef)) {
        element.asset = hydrate(element.assetRef);
      }
      element.assetLayers = (element.assetLayers || []).flatMap(layer => {
        if (!isHydratableDialogAssetReference(layer.assetRef)) return [];
        return [{ ...layer, asset: hydrate(layer.assetRef) }];
      });
      if (element.assetLayers.length === 0) element.assetLayers = undefined;

      if (preview.command !== 'ADDBUTTONEX') continue;
      for (const effect of preview.effects || []) {
        if (
          effect.dynamicFields?.length
          || effect.invalidFields?.length
          || !isHydratableDialogAssetReference(effect.assetRef)
          || !Number.isInteger(effect.frameCount)
          || effect.frameCount! <= 0
        ) continue;
        const references = sequentialFrameAssetReferences(effect.assetRef, effect.frameCount);
        effect.frames = references.map((reference, index) => hydrate(reference) || ({
          status: 'missing',
          archiveLabel: addButtonReferenceLabel(reference),
          message: `${effect.state} 特效第 ${index + 1} 帧未解析`,
        }));
      }
    }
  }
}

export function isHydratableDialogAssetReference(
  reference: DialogAssetReference | undefined
): reference is DialogAssetReference {
  if (!reference || !Number.isSafeInteger(reference.imageIndex) || reference.imageIndex! < 0) {
    return false;
  }
  if (reference.willIndex !== undefined) {
    return Number.isSafeInteger(reference.willIndex) && reference.willIndex >= 0;
  }
  return Boolean(reference.archiveName?.trim() || reference.archiveRole);
}

/**
 * Rebuild TextAtlas glyphs from its typed source contract. This deliberately
 * discards glyph refs/assets carried by stale serialized models: dynamic or
 * invalid fields must never become a positive-looking workspace request.
 */
export function hydrateTextAtlasAssets(
  model: { scenes: Array<{ elements: DialogElement[] }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  const hydrate = (reference: DialogAssetReference): DialogAssetPreview | undefined => {
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    return cache.get(key);
  };
  const ready = (asset: DialogAssetPreview | undefined): boolean => (
    asset?.status === 'ready' && Boolean(asset.url)
  );

  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const preview = element.imageTextPreview;
      if (!preview?.textAtlasVariant) continue;

      delete element.asset;
      delete element.assetRef;
      for (const glyph of preview.glyphs || []) {
        delete glyph.asset;
        delete glyph.assetRef;
      }
      const dynamicFields = preview.dynamicFields || [];
      const invalidFields = preview.invalidFields || [];
      const base = preview.baseAssetRef;
      const digits = /^\d+$/u.test(preview.value) ? preview.value : undefined;
      const baseValid = isHydratableDialogAssetReference(base);
      const resourceFields = new Set(['archive', 'image', 'glyph-width', 'glyph-height']);
      const blockingDynamicFields = dynamicFields.filter(field => resourceFields.has(field));
      const blockingInvalidFields = invalidFields.filter(field => resourceFields.has(field));
      // A dynamic display value does not make an otherwise static atlas sheet
      // unsafe. Only resource/geometry fields may block hydration.
      const blocked = blockingDynamicFields.length > 0
        || blockingInvalidFields.length > 0
        || !baseValid
        || !digits;

      if (blocked) {
        preview.assetContract = 'blocked';
        preview.assetContractMessage = blockingDynamicFields.length > 0
          ? `动态字段 ${blockingDynamicFields.join('、')} 未请求素材，不借用 MOV 当前值`
          : `无效字段 ${blockingInvalidFields.join('、') || '素材合同'} 已阻止 TextAtlas 素材请求`;
        const widthValid = Number.isSafeInteger(preview.glyphWidth)
          && preview.glyphWidth! > 0
          && !dynamicFields.includes('glyph-width')
          && !invalidFields.includes('glyph-width');
        preview.glyphs = digits
          ? [...digits].map(character => ({
            character,
            // sourceX is safe only when the source-side glyph width is safe.
            // Height is not part of the horizontal crop coordinate.
            ...(preview.textAtlasVariant === 'newui-atlas' && widthValid
              ? { sourceX: Number(character) * preview.glyphWidth! }
              : {}),
          }))
          : [];
        continue;
      }

      element.assetRef = { ...base };
      if (preview.textAtlasVariant === 'newui-atlas') {
        const glyphWidth = preview.glyphWidth;
        const glyphHeight = preview.glyphHeight;
        if (!Number.isSafeInteger(glyphWidth) || glyphWidth! <= 0
          || !Number.isSafeInteger(glyphHeight) || glyphHeight! <= 0) {
          preview.assetContract = 'blocked';
          preview.assetContractMessage = '字形宽高不是正整数，已阻止整图裁切';
          preview.glyphs = [];
          continue;
        }
        const asset = hydrate(base);
        element.asset = asset;
        const assetReady = ready(asset);
        const expectedWidth = glyphWidth! * 10;
        const expectedHeight = glyphHeight!;
        const matched = assetReady
          && Number(asset!.width) === expectedWidth
          && Number(asset!.height) === expectedHeight;
        preview.assetContract = matched ? 'matched' : assetReady ? 'mismatch' : 'unavailable';
        preview.assetContractMessage = matched
          ? `整图尺寸 ${expectedWidth}×${expectedHeight} 与 10 个数字字形合同一致`
          : assetReady
            ? `素材实际 ${Number(asset!.width) || '?'}×${Number(asset!.height) || '?'}，预期 10×${glyphWidth}=${expectedWidth} 且高度 ${expectedHeight}`
            : (asset?.message || 'TextAtlas 整图素材未在本地缓存中解析');
        preview.glyphs = [...digits].map(character => ({
          character,
          assetRef: { ...base },
          sourceX: Number(character) * glyphWidth!,
          ...(matched ? { asset } : {}),
        }));
        continue;
      }

      let allReady = true;
      preview.glyphs = [...digits].map(character => {
        const reference: DialogAssetReference = {
          ...base,
          imageIndex: base.imageIndex! + Number(character),
        };
        const asset = hydrate(reference);
        if (!ready(asset)) allReady = false;
        return {
          character,
          assetRef: reference,
          ...(ready(asset) ? { asset } : {}),
        };
      });
      element.asset = preview.glyphs.find(glyph => glyph.asset)?.asset;
      preview.assetContract = allReady ? 'matched' : 'unavailable';
      preview.assetContractMessage = allReady
        ? '连续 0-9 单图素材已按各自真实尺寸解析'
        : '一个或多个连续数字图片未在本地缓存中解析';
    }
  }
}

/** Rebuild MenuItem's four resource slots only from source-classified diagnostics. */
export function hydrateMenuItemAssets(
  model: { scenes: Array<{ elements: DialogElement[] }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  const hydrate = (reference: DialogAssetReference): DialogAssetPreview | undefined => {
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    return cache.get(key);
  };
  const roles = new Map([
    ['img', 'background'],
    ['arrowimg', 'arrow'],
    ['selectimg', 'selected'],
    ['listimg', 'list-background'],
  ] as const);
  const menuRoles = new Set<string>(roles.values());

  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const diagnostics = element.menuPreview?.assetDiagnostics;
      if (!diagnostics) continue;
      delete element.asset;
      delete element.assetRef;
      const layers = (element.assetLayers || [])
        .filter(layer => !menuRoles.has(layer.role))
        .map(layer => ({ ...layer }));

      for (const diagnostic of diagnostics) {
        const role = diagnostic.role || roles.get(diagnostic.field);
        if (!role) continue;
        diagnostic.role = role;
        delete diagnostic.asset;
        if (diagnostic.sourceStatus !== 'default' && diagnostic.sourceStatus !== 'static') {
          diagnostic.status = diagnostic.sourceStatus;
          delete diagnostic.assetRef;
          continue;
        }
        if (!isHydratableDialogAssetReference(diagnostic.assetRef)) {
          diagnostic.sourceStatus = 'invalid';
          diagnostic.status = 'invalid';
          diagnostic.message = '诊断中的素材引用无效，Provider 已阻止请求';
          delete diagnostic.assetRef;
          continue;
        }
        const asset = hydrate(diagnostic.assetRef);
        diagnostic.asset = asset;
        diagnostic.status = asset?.status === 'ready' && asset.url
          ? diagnostic.sourceStatus
          : 'missing';
        if (diagnostic.status === 'missing') {
          diagnostic.message = asset?.message || '素材引用合法，但本地缓存未解析';
        }
        if (role === 'background') {
          element.assetRef = { ...diagnostic.assetRef };
          element.asset = asset;
        } else {
          layers.push({ role, assetRef: { ...diagnostic.assetRef }, asset });
        }
      }
      element.assetLayers = layers.length > 0 ? layers : undefined;
    }
  }
}

/**
 * Rebuild ListView scrollbar layers only from per-role source diagnostics.
 * Serialized previews can contain valid-looking positive cache references from
 * a prior MOV resolution; those refs are discarded unless the original source
 * slot was independently classified as static.
 */
export function hydrateListViewAssets(
  model: { scenes: Array<{ elements: DialogElement[] }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  const hydrate = (reference: DialogAssetReference): DialogAssetPreview | undefined => {
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    return cache.get(key);
  };
  const scrollbarRoles = new Set([
    'scrollbar',
    'scroll-start', 'scroll-start-hover', 'scroll-start-pressed',
    'scroll-thumb', 'scroll-thumb-hover', 'scroll-thumb-pressed',
    'scroll-end', 'scroll-end-hover', 'scroll-end-pressed',
  ]);

  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const preview = element.containerPreview;
      if (preview?.variant !== 'list' || !preview.scrollbarDiagnostics) continue;
      const layers = (element.assetLayers || [])
        .filter(layer => !scrollbarRoles.has(layer.role))
        .map(layer => ({ ...layer }));
      for (const diagnostic of preview.scrollbarDiagnostics) {
        delete diagnostic.asset;
        if (
          diagnostic.sourceStatus !== 'static'
          || !isHydratableDialogAssetReference(diagnostic.assetRef)
        ) {
          diagnostic.status = diagnostic.sourceStatus;
          delete diagnostic.assetRef;
          continue;
        }
        const assetRef = { ...diagnostic.assetRef };
        const asset = hydrate(assetRef);
        diagnostic.assetRef = assetRef;
        diagnostic.asset = asset;
        diagnostic.status = asset?.status === 'ready' && asset.url ? 'static' : 'missing';
        if (diagnostic.status === 'missing') {
          diagnostic.message = asset?.message || '素材引用合法，但本地缓存或 GameUIPack 未解析';
        }
        layers.push({
          role: diagnostic.role,
          assetRef,
          ...(asset ? { asset } : {}),
        });
      }
      element.assetLayers = layers.length > 0 ? layers : undefined;
    }
  }
}

/**
 * Hydrate Button/IMGEX/CheckBox state pixels exclusively from the parser's
 * per-role diagnostics. Older models used imageIndex=0 as a fallback and may
 * still carry those references in assetRef/assetLayers; rebuilding the state
 * slots here prevents dynamic, invalid or missing roles from reaching any
 * workspace/cache resolver.
 */
export function hydrateStatefulControlAssets(
  model: { scenes: Array<{ elements: DialogElement[] }> },
  resolve: (reference: DialogAssetReference) => DialogAssetPreview | undefined
): void {
  const cache = new Map<string, DialogAssetPreview | undefined>();
  const hydrate = (reference: DialogAssetReference): DialogAssetPreview | undefined => {
    const key = JSON.stringify(reference);
    if (!cache.has(key)) cache.set(key, resolve(reference));
    return cache.get(key);
  };
  const stateRoles = new Set(['normal', 'hover', 'pressed', 'selected']);

  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const diagnostics = element.assetStateDiagnostics;
      if (!diagnostics) continue;

      delete element.asset;
      delete element.assetRef;
      const layers = (element.assetLayers || [])
        .filter(layer => !stateRoles.has(layer.role))
        .map(layer => ({ ...layer }));

      for (const diagnostic of diagnostics) {
        delete diagnostic.asset;
        if (
          diagnostic.status !== 'static'
          || !isHydratableDialogAssetReference(diagnostic.assetRef)
        ) {
          delete diagnostic.assetRef;
          continue;
        }

        const assetRef = { ...diagnostic.assetRef };
        const asset = hydrate(assetRef);
        diagnostic.assetRef = assetRef;
        if (asset) diagnostic.asset = asset;
        if (diagnostic.role === 'normal') {
          element.assetRef = assetRef;
          if (asset) element.asset = asset;
        } else {
          layers.push({
            role: diagnostic.role,
            assetRef,
            ...(asset ? { asset } : {}),
          });
        }
      }
      element.assetLayers = layers.length > 0 ? layers : undefined;
    }
  }
}

/**
 * Treat source diagnostics as authoritative before generic provider hydration.
 * This is deliberately role-specific so a dynamic fill does not erase a
 * separately proven static background. It also protects against stale models
 * that still contain temporarily resolved MOV values or invalid frame counts.
 */
export function sanitizeProgressControlAssetReferences(
  model: { scenes: Array<{ elements: DialogElement[] }> }
): void {
  const roleFields = new Map<string, 'background-image' | 'progress-image' | 'thumb-image'>([
    ['background', 'background-image'],
    ['progress', 'progress-image'],
    ['thumb', 'thumb-image'],
  ]);
  for (const scene of model.scenes || []) {
    for (const element of scene.elements || []) {
      const preview = element.progressPreview;
      if (!preview) continue;
      const blocked = new Set<string>([
        ...(preview.dynamicFields || []),
        ...(preview.invalidFields || []),
        ...(element.sliderPreview?.dynamicFields || []),
        ...(element.sliderPreview?.invalidFields || []),
      ]);
      const archiveBlocked = blocked.has('archive');
      const frameCountBlocked = blocked.has('frame-count');
      delete element.asset;
      element.animationFrames = undefined;
      if (frameCountBlocked) delete preview.frameCount;

      const sanitize = (
        reference: DialogAssetReference | undefined,
        field: 'background-image' | 'progress-image' | 'thumb-image'
      ): DialogAssetReference | undefined => {
        if (
          archiveBlocked
          || blocked.has(field)
          || !isHydratableDialogAssetReference(reference)
        ) return undefined;
        const safe = { ...reference };
        if (field === 'progress-image' && frameCountBlocked) delete safe.frameCount;
        return safe;
      };

      const primaryField = element.statementId === 'newui-percentimg-996pc'
        ? 'progress-image'
        : 'background-image';
      element.assetRef = sanitize(element.assetRef, primaryField);
      element.assetLayers = (element.assetLayers || []).flatMap(layer => {
        delete layer.asset;
        const field = roleFields.get(layer.role);
        if (!field) {
          return isHydratableDialogAssetReference(layer.assetRef)
            ? [{ ...layer, assetRef: { ...layer.assetRef } }]
            : [];
        }
        const reference = sanitize(layer.assetRef, field);
        return reference ? [{ ...layer, assetRef: reference }] : [];
      });
      if (element.assetLayers.length === 0) element.assetLayers = undefined;
    }
  }
}

function addButtonReferenceLabel(reference: DialogAssetReference): string {
  const archive = reference.willIndex !== undefined
    ? `WIL ${reference.willIndex}`
    : reference.archiveName || '未知归档';
  return `${archive} / ${reference.imageIndex ?? '?'}`;
}

/**
 * Hydrate GOM's `ItemShow#IDX#mode` hover remark without pretending that the
 * engine's unpublished client tooltip layout is available offline.
 *
 * The GOM manual identifies mode 0 as a database item and mode 1 as a title.
 * Only mode 0 has a proven StdItems/cfg_item lookup path in BOO, so every other
 * mode deliberately keeps the parser's IDX/mode placeholder and a visible
 * evidence-boundary warning.
 */
export function hydrateGomItemShowTooltip(
  element: DialogElement,
  resolveField: DialogItemTooltipFieldResolver
): void {
  const source = element.tooltipPreview;
  if (source?.kind !== 'item' || source.itemIndex === undefined) return;

  clearGomItemShowTooltipBoundary(element);
  if (source.itemMode !== 0) {
    const boundary = source.itemMode === 1
      ? `[Evidence-blocked] GOM ItemShow#${source.itemIndex}#1：手册仅说明该模式为“称号”，`
        + '未公开字段来源与客户端属性窗排版；Ctrl+F12 保留 IDX/模式占位，不借用 StdItems 物品字段'
      : `[Evidence-blocked] GOM ItemShow#${source.itemIndex}#${source.itemMode ?? '?'} `
        + '的模式未在本地官方手册中定义；Ctrl+F12 保留 IDX/模式占位，不猜测属性来源';
    appendElementWarning(element, boundary);
    return;
  }

  const fields: DialogItemDatabaseFields = {};
  for (const field of DIALOG_ITEM_TOOLTIP_DATABASE_FIELDS) {
    const value = resolveField(source.itemIndex, field);
    if (value !== undefined) fields[field] = value;
  }
  const hydrated = buildDialogItemTooltip({
    mode: 'database-index',
    itemIndex: source.itemIndex,
    showTips: true,
    label: `物品 IDX ${source.itemIndex}`,
  }, fields);
  if (hydrated) {
    element.tooltipPreview = {
      ...hydrated,
      raw: source.raw,
      offsetX: source.offsetX,
      offsetY: source.offsetY,
      itemIndex: source.itemIndex,
      itemMode: source.itemMode,
    };
  }
  if (Object.keys(fields).length === 0) {
    appendElementWarning(
      element,
      `[Environment-blocked] GOM ItemShow#${source.itemIndex}#0 `
        + '未在当前脚本所属工作区的物品数据库中读取到可证明的基础字段；已保留 IDX 占位'
    );
  }
}

function clearGomItemShowTooltipBoundary(element: DialogElement): void {
  const remaining = (element.warning || '')
    .split('；')
    .filter(part => !/^\[(?:Evidence|Environment)-blocked\] GOM ItemShow#/i.test(part.trim()));
  element.warning = remaining.join('；') || undefined;
}

function appendElementWarning(element: DialogElement, warning: string): void {
  if (element.warning?.includes(warning)) return;
  element.warning = element.warning ? `${element.warning}；${warning}` : warning;
}

export const OPEN_NPC_DIALOG_VISUAL_COMMAND = 'boo.openNpcDialogVisualEditor';

export function hydrateAddDlgWindowAssets(
  model: NpcDialogDocumentModel,
  resolve: (reference: DialogAssetReference | undefined) => DialogAssetPreview | undefined
): void {
  const hydrated = new Map<string, DialogAssetPreview | undefined>();
  for (const scene of model.scenes) {
    const window = scene.addDlgWindow;
    if (!window?.assetRef) continue;
    if (!hydrated.has(window.id)) {
      hydrated.set(window.id, resolve(window.assetRef));
    }
    window.asset = hydrated.get(window.id);
  }
}

const GEE_OFFSET_STATE_KEY = 'boo.npcDialogVisual.geeMemoOffset';
const FLOATING_WINDOW_COMMAND = 'workbench.action.moveEditorToNewWindow';

interface StoredGeeOffset {
  x: number;
  y: number;
}

interface NpcDialogSession {
  key: string;
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  model: NpcDialogDocumentModel;
  sourceViewColumn: vscode.ViewColumn | undefined;
  dirty: boolean;
  conflict: boolean;
  applying: boolean;
  floatingStarted: boolean;
  previewConditions: Record<string, boolean>;
  modelRevision: number;
  disposables: vscode.Disposable[];
}

interface NpcDialogWebviewMessage {
  type?: string;
  changes?: DialogCoordinateChange[];
  elementId?: string;
  dirty?: boolean;
  x?: number;
  y?: number;
  groupId?: string;
  satisfied?: boolean;
}

export function registerNpcDialogVisualEditor(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const manager = new NpcDialogVisualEditorManager(context);
  const command = vscode.commands.registerCommand(
    OPEN_NPC_DIALOG_VISUAL_COMMAND,
    () => manager.openFromActiveEditor()
  );
  return vscode.Disposable.from(command, manager);
}

class NpcDialogVisualEditorManager implements vscode.Disposable {
  private readonly sessions = new Map<string, NpcDialogSession>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly staticLanguage;
  private readonly scriptDataResolver = new ScriptDataResolver();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.staticLanguage = loadStaticLanguageData(context.extensionPath, message => {
      console.info(`[BOO NPC界面] ${message}`);
    });
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => this.onDocumentChanged(event)),
      vscode.workspace.onDidCloseTextDocument(document => this.onDocumentClosed(document)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('boo.engine')) return;
        for (const session of this.sessions.values()) {
          void this.reloadSession(session, true, session.dirty);
        }
      })
    );
    const companionWatcher = vscode.workspace.createFileSystemWatcher(
      '**/Envir/Market_Def/QFunction-0.txt'
    );
    this.disposables.push(
      companionWatcher,
      companionWatcher.onDidChange(uri => this.onCompanionFileChanged(uri)),
      companionWatcher.onDidCreate(uri => this.onCompanionFileChanged(uri)),
      companionWatcher.onDidDelete(uri => this.onCompanionFileChanged(uri))
    );
  }

  async openFromActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开 NPC 脚本并将光标放在 [@函数] 内');
      return;
    }
    if (!this.staticLanguage) {
      vscode.window.showErrorMessage('界面语句目录加载失败，无法启动 NPC 界面可视化编辑器');
      return;
    }
    const document = editor.document;
    if (document.uri.scheme !== 'file' || path.extname(document.fileName).toLowerCase() !== '.txt') {
      vscode.window.showWarningMessage('NPC 界面可视化编辑器仅支持工作区中的 TXT 脚本');
      return;
    }

    let model: NpcDialogDocumentModel;
    try {
      model = await this.createModel(document, document.offsetAt(editor.selection.active));
    } catch (error) {
      vscode.window.showWarningMessage(errorMessage(error));
      return;
    }
    const key = `${document.uri.toString()}#${model.functionLabel.toUpperCase()}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn || vscode.ViewColumn.Beside, false);
      await this.postModel(existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'booNpcDialogVisualEditor',
      `NPC界面 ${model.functionLabel}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: webviewResourceRoots([
          this.context.extensionPath,
          path.join(this.context.extensionPath, 'media'),
          getPatchCacheRoot(this.context),
        ]),
      }
    );
    const session: NpcDialogSession = {
      key,
      panel,
      document,
      model,
      sourceViewColumn: editor.viewColumn,
      dirty: false,
      conflict: false,
      applying: false,
      floatingStarted: false,
      previewConditions: Object.fromEntries(
        model.conditionGroups.map(group => [group.id, group.satisfied])
      ),
      modelRevision: 0,
      disposables: [],
    };
    session.disposables.push(
      panel.onDidDispose(() => this.disposeSession(session)),
      panel.webview.onDidReceiveMessage(message => this.onMessage(session, message))
    );
    this.sessions.set(key, session);
    panel.webview.html = this.webviewHtml(panel.webview);
  }

  dispose(): void {
    for (const session of [...this.sessions.values()]) session.panel.dispose();
    this.sessions.clear();
    this.scriptDataResolver.dispose();
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
  }

  private async createModel(
    document: vscode.TextDocument,
    cursorOffset: number,
    functionLabel?: string,
    conditionStates?: Readonly<Record<string, boolean>>
  ): Promise<NpcDialogDocumentModel> {
    if (!this.staticLanguage) throw new Error('界面语句目录尚未加载');
    const engine = normalizeEngineId(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    await this.scriptDataResolver.prepareFor(document.fileName, engine);
    const definition = getEngineDefinition(engine);
    const text = document.getText();
    const labelOffset = functionLabel
      ? findFunctionLabelOffset(text, functionLabel) ?? cursorOffset
      : cursorOffset;
    const offsets = this.dialogOffsets(document, engine);
    const catalog = buildDialogStatementCatalog(this.staticLanguage, engine);
    const workspaceRoot = workspaceRootForDocument(document);
    const companion = engine === 'GOM' && workspaceRoot
      ? this.resolveCompanion(workspaceRoot)
      : { status: 'missing', candidateFilePaths: [] } as AddDlgCompanionResolution;
    return parseNpcDialogDocumentWithCompanion(text, {
      uri: document.uri.toString(),
      fileName: path.basename(document.fileName),
      filePath: document.fileName,
      documentVersion: document.version,
      engine,
      engineLabel: definition.label,
      cursorOffset: labelOffset,
      offsets,
      catalog,
      conditionStates,
      dataOptions: this.scriptDataResolver.optionsFor(document.fileName, engine),
    }, companion);
  }

  private resolveCompanion(workspaceRoot: string): AddDlgCompanionResolution {
    const resolution = resolveAddDlgCompanion(workspaceRoot);
    if (resolution.status !== 'found') return resolution;
    const target = normalizedFilePath(resolution.source.filePath);
    const openDocument = vscode.workspace.textDocuments.find(document => (
      normalizedFilePath(document.fileName) === target
    ));
    if (!openDocument?.isDirty) return resolution;
    return {
      ...resolution,
      source: {
        ...resolution.source,
        uri: openDocument.uri.toString(),
        text: openDocument.getText(),
        documentVersion: openDocument.version,
      },
    };
  }

  private dialogOffsets(document: vscode.TextDocument, engine: EngineId): NpcDialogOffsets {
    const workspaceRoot = workspaceRootForDocument(document);
    const mir200 = workspaceRoot ? findMir200Directory(workspaceRoot) : undefined;
    const setupPath = mir200 ? path.join(mir200, '!Setup.txt') : undefined;
    const setup = setupPath && isFile(setupPath)
      ? parseNpcDialogOffsets(decodeTextFile(fs.readFileSync(setupPath)).text, setupPath)
      : parseNpcDialogOffsets('', setupPath);
    if (engine !== 'GEE') return setup;

    const stored = this.context.workspaceState.get<StoredGeeOffset>(GEE_OFFSET_STATE_KEY);
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return {
        ...workspaceNpcDialogOffsets(stored.x, stored.y),
        menuX: setup.menuX,
        menuY: setup.menuY,
        setupPath,
      };
    }
    if (setup.configured) return setup;
    return { ...setup, source: 'default', configured: false };
  }

  private async onMessage(
    session: NpcDialogSession,
    message: NpcDialogWebviewMessage
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.postModel(session);
          void this.moveToFloatingWindow(session);
          return;
        case 'dirtyChanged':
          session.dirty = Boolean(message.dirty);
          return;
        case 'reload':
          if (!(await this.confirmDiscardDrafts(session, '重新载入'))) return;
          await this.reloadSession(session, true);
          return;
        case 'apply':
          await this.applyChanges(session, message.changes || [], false);
          return;
        case 'save':
          await this.applyChanges(session, message.changes || [], true);
          return;
        case 'locate':
          await this.locateElement(session, String(message.elementId || ''));
          return;
        case 'openPatchManager':
          await vscode.commands.executeCommand('workbench.view.extension.boo-patch');
          return;
        case 'saveGeeOffsets':
          await this.saveGeeOffsets(session, message.x, message.y);
          return;
        case 'previewCondition':
          await this.previewCondition(
            session,
            String(message.groupId || ''),
            message.satisfied === true
          );
          return;
        case 'resetPreview':
          await this.resetPreview(session);
          return;
      }
    } catch (error) {
      const messageText = errorMessage(error);
      void session.panel.webview.postMessage({ type: 'operationError', message: messageText });
      vscode.window.showErrorMessage(`NPC 界面编辑失败: ${messageText}`);
    }
  }

  private async applyChanges(
    session: NpcDialogSession,
    changes: DialogCoordinateChange[],
    save: boolean
  ): Promise<void> {
    if (session.conflict || session.document.version !== session.model.documentVersion) {
      session.conflict = true;
      void session.panel.webview.postMessage({
        type: 'conflict',
        message: '源码已发生变化，请先重新载入，避免覆盖文本修改',
      });
      return;
    }
    const currentText = session.document.getText();
    const edits = buildDialogCoordinateEdits(currentText, session.model, changes);
    session.applying = true;
    try {
      if (edits.replacements.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const replacement of edits.replacements) {
          workspaceEdit.replace(
            session.document.uri,
            new vscode.Range(
              session.document.positionAt(replacement.start),
              session.document.positionAt(replacement.end)
            ),
            replacement.text
          );
        }
        const applied = await vscode.workspace.applyEdit(workspaceEdit);
        if (!applied) throw new Error('VS Code 未接受坐标修改');
      }
      if (save && !(await session.document.save())) throw new Error('文件保存失败');
    } finally {
      this.updateSessionState(session, { applying: false });
    }
    if (!this.updateSessionState(session, { dirty: false, conflict: false })) return;
    await this.reloadSession(session, false);
    void session.panel.webview.postMessage({
      type: 'operationComplete',
      message: save
        ? `已保存 ${edits.changedElements} 个元素的坐标`
        : `已应用 ${edits.changedElements} 个元素，可用 Ctrl+Z 撤销`,
      saved: save,
    });
  }

  private async saveGeeOffsets(
    session: NpcDialogSession,
    rawX: number | undefined,
    rawY: number | undefined
  ): Promise<void> {
    if (session.model.engine !== 'GEE') throw new Error('只有翎风引擎使用手动缓存的坐标修正');
    if (!(await this.confirmDiscardDrafts(session, '修改坐标修正值'))) return;
    const x = normalizeOffset(rawX);
    const y = normalizeOffset(rawY);
    await this.context.workspaceState.update(GEE_OFFSET_STATE_KEY, { x, y });
    if (!this.updateSessionState(session, { dirty: false })) return;
    await this.reloadSession(session, true);
    void session.panel.webview.postMessage({
      type: 'operationComplete',
      message: `翎风坐标修正已按当前工作区缓存为 ${x}, ${y}`,
    });
  }

  private async confirmDiscardDrafts(
    session: NpcDialogSession,
    action: string
  ): Promise<boolean> {
    if (!session.dirty) return true;
    const selected = await vscode.window.showWarningMessage(
      `${action}会放弃当前尚未应用到代码的坐标草稿。`,
      { modal: true },
      '放弃草稿并继续'
    );
    return selected === '放弃草稿并继续';
  }

  private async previewCondition(
    session: NpcDialogSession,
    groupId: string,
    satisfied: boolean
  ): Promise<void> {
    if (!session.model.conditionGroups.some(group => group.id === groupId)) {
      throw new Error('条件已发生变化，请重新载入后再切换');
    }
    session.previewConditions[groupId] = satisfied;
    await this.reloadSession(session, false, true);
  }

  private async resetPreview(session: NpcDialogSession): Promise<void> {
    session.previewConditions = Object.fromEntries(
      session.model.conditionGroups.map(group => [group.id, false])
    );
    await this.reloadSession(session, false, true);
  }

  private normalizedPreviewConditions(
    model: NpcDialogDocumentModel,
    values: Readonly<Record<string, boolean>>
  ): Record<string, boolean> {
    return Object.fromEntries(
      model.conditionGroups.map(group => [group.id, values[group.id] === true])
    );
  }

  private async reloadSession(
    session: NpcDialogSession,
    userInitiated: boolean,
    preserveDrafts = false
  ): Promise<void> {
    const revision = ++session.modelRevision;
    const previewConditions = { ...session.previewConditions };
    try {
      const model = await this.createModel(
        session.document,
        session.model.functionStart,
        session.model.functionLabel,
        previewConditions
      );
      if (revision !== session.modelRevision) return;
      session.previewConditions = this.normalizedPreviewConditions(model, previewConditions);
      if (!this.updateSessionState(session, {
        model,
        dirty: preserveDrafts ? session.dirty : false,
        conflict: false,
      })) return;
      session.panel.title = `NPC界面 ${session.model.functionLabel}`;
      await this.postModel(session, preserveDrafts, revision);
    } catch (error) {
      if (revision !== session.modelRevision) return;
      if (!this.updateSessionState(session, { conflict: true })) return;
      void session.panel.webview.postMessage({ type: 'conflict', message: errorMessage(error) });
      if (userInitiated) vscode.window.showWarningMessage(errorMessage(error));
    }
  }

  private updateSessionState(
    session: NpcDialogSession,
    state: Partial<Pick<NpcDialogSession, 'model' | 'dirty' | 'conflict' | 'applying'>>
  ): boolean {
    if (this.sessions.get(session.key) !== session) return false;
    Object.assign(session, state);
    return true;
  }

  private async postModel(
    session: NpcDialogSession,
    preserveDrafts = false,
    revision = session.modelRevision
  ): Promise<void> {
    const model = session.model;
    await this.hydrateAssets(model, session.panel.webview, session.document);
    if (
      this.sessions.get(session.key) !== session
      || session.model !== model
      || session.modelRevision !== revision
    ) return;
    void session.panel.webview.postMessage({
      type: 'model',
      model,
      preserveDrafts,
      previewRevision: revision,
      geeOffsetHelp: model.engine === 'GEE'
        ? '请在登陆器配置 - 客户端界面设置 - 其他配置 - NPC对话框文字坐标修正中查看数值'
        : '',
    });
  }

  private async hydrateAssets(
    model: NpcDialogDocumentModel,
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): Promise<void> {
    const cache = new Map<string, DialogAssetPreview>();
    const archiveCache = new Map<string, CachedPatchPak>();
    const assetTableCache = new Map<string, CachedPatchAssetTable>();
    const exactIdentityPreviews = new Set<DialogAssetPreview>();
    let resolutionSnapshot: DialogAssetResolutionSnapshot | undefined;
    // Production hydration takes one immutable view of the selected client's
    // archive files. Selecting the package before selecting its slot prevents
    // a missing ItemsN slot from being filled by another resource root/client.
    if (this.context) {
      const state = this.patchState(model.engine);
      const resourceRoots = state ? clientResourceLayoutFromState(state)?.dataRoots || [] : [];
      const archiveExtensions = uiEditorArchiveExtensions(model.engine);
      resolutionSnapshot = {
        cacheRoot: getPatchCacheRoot(this.context),
        resourceRoots,
        archiveFiles: resourceRoots.length > 0
          ? await scanClientArchiveFiles(resourceRoots, archiveExtensions)
          : [],
        previewPaks: new Map<DialogAssetPreview, CachedPatchPak>(),
      };
    }
    const resolve = (
      reference: DialogAssetReference | undefined,
      requireExactIdentity = false
    ): DialogAssetPreview | undefined => {
      if (!isHydratableDialogAssetReference(reference)) return undefined;
      const key = JSON.stringify(reference);
      const existing = cache.get(key);
      if (existing) {
        if (requireExactIdentity) exactIdentityPreviews.add(existing);
        return existing;
      }
      const preview = this.resolveAsset(
        reference,
        model.engine,
        webview,
        document,
        archiveCache,
        assetTableCache,
        resolutionSnapshot
      );
      cache.set(key, preview);
      if (requireExactIdentity) exactIdentityPreviews.add(preview);
      return preview;
    };
    hydrateAddDlgWindowAssets(model, resolve);
    hydrateDialogBackgroundAssets(model, resolve);
    hydrateAddButtonAssets(model, resolve);
    sanitizeProgressControlAssetReferences(model);
    hydrateStatefulControlAssets(model, resolve);
    hydrateTextAtlasAssets(model, resolve);
    hydrateMenuItemAssets(model, resolve);
    hydrateListViewAssets(model, resolve);
    for (const scene of model.scenes) {
      for (const element of scene.elements) {
        if (!element.addButtonPreview
          && !element.assetStateDiagnostics
          && !element.imageTextPreview?.textAtlasVariant
          && !element.menuPreview?.assetDiagnostics
          && !element.containerPreview?.scrollbarDiagnostics) {
          element.asset = resolve(element.assetRef);
        }
        const layers = element.addButtonPreview
          ? [...(element.assetLayers || [])]
          : element.assetStateDiagnostics
            ? [...(element.assetLayers || [])]
          : element.menuPreview?.assetDiagnostics
            ? [...(element.assetLayers || [])]
          : element.containerPreview?.scrollbarDiagnostics
            ? [...(element.assetLayers || [])]
          : (element.assetLayers || [])
            .filter(layer => layer.role !== 'item')
            .map(layer => ({ ...layer, asset: resolve(layer.assetRef) }));
        const itemReference = this.resolveItemAssetReference(element, model.engine, document);
        if (itemReference) {
          layers.push({
            role: 'item',
            assetRef: itemReference,
            asset: resolve(
              itemReference,
              element.statementId === 'item-show'
                || element.statementId === 'newui-itemshow-996pc'
            ),
          });
        }
        element.assetLayers = layers.length > 0 ? layers : undefined;
        if (model.engine === 'GOM') {
          hydrateGomItemShowTooltip(element, (itemIndex, field) => (
            this.scriptDataResolver.resolveItemFieldByIndex(
              document.fileName,
              itemIndex,
              field,
              model.engine
            )
          ));
        }
        if (!element.tooltipPreview && element.itemPreview?.showTips === true) {
          element.tooltipPreview = buildDialogItemTooltip(
            element.itemPreview,
            this.resolveItemTooltipFields(element.itemPreview, document, model.engine)
          );
        }
        if (element.imageTextPreview && !element.imageTextPreview.textAtlasVariant) {
          element.imageTextPreview.glyphs = element.imageTextPreview.glyphs.map(glyph => ({
            ...glyph,
            ...(glyph.assetRef ? { asset: resolve(glyph.assetRef) } : {}),
          }));
          if (element.imageTextPreview.glyphBank) {
            element.imageTextPreview.glyphBank = element.imageTextPreview.glyphBank.map(glyph => ({
              ...glyph,
              ...(glyph.assetRef ? { asset: resolve(glyph.assetRef) } : {}),
            }));
          }
        }
        if (element.modelPreview) {
          element.modelPreview.layers = element.modelPreview.layers.map(layer => ({
            ...layer,
            asset: resolve(layer.assetRef),
          }));
        }
        const progressFrameReference = element.progressPreview?.frameCount
          ? layers.find(layer => layer.role === 'progress')?.assetRef
          : undefined;
        const frameReference = element.animationPreview ? element.assetRef : progressFrameReference;
        const requestedFrameCount = element.animationPreview?.frameCount
          ?? element.progressPreview?.frameCount;
        if (
          isHydratableDialogAssetReference(frameReference)
          && Number.isInteger(requestedFrameCount)
          && requestedFrameCount! > 0
        ) {
          const requested = requestedFrameCount!;
          const frameReferences = sequentialFrameAssetReferences(frameReference, requested);
          const frameCount = frameReferences.length;
          element.animationFrames = frameReferences.map(reference => resolve(reference)!);
          const missingSlots = element.animationFrames.flatMap((frame, index) => (
            frame?.status === 'ready' ? [] : [index]
          ));
          if (missingSlots.length > 0) {
            const label = element.animationPreview ? '动画' : '进度条动画';
            const positions = missingSlots.slice(0, 8).map(index => index + 1).join('、');
            const suffix = missingSlots.length > 8 ? ` 等 ${missingSlots.length} 帧` : '';
            const warning = `${label}缺少第 ${positions}${suffix}；时间槽保持不压缩`;
            element.warning = element.warning ? `${element.warning}；${warning}` : warning;
          }
          if (requested > frameCount) {
            const label = element.animationPreview ? '动画' : '进度条动画';
            element.warning = element.warning
              ? `${element.warning}；${label}超过 240 帧，预览仅播放前 240 帧`
              : `${label}超过 240 帧，预览仅播放前 240 帧`;
          }
        } else {
          element.animationFrames = undefined;
        }
      }
    }
    if (resolutionSnapshot && exactIdentityPreviews.size > 0) {
      await validateExactDialogAssetIdentities(exactIdentityPreviews, resolutionSnapshot);
    }
    reflowNpcDialogLayout(model);
  }

  private resolveItemAssetReference(
    element: DialogElement,
    engine: EngineId,
    document: vscode.TextDocument
  ): DialogAssetReference | undefined {
    const item = element.itemPreview;
    if (!item) return undefined;

    let looksValue: unknown;
    if (item.mode === 'database-index') {
      if (item.itemIndex === undefined) {
        item.message = '物品 IDX 为动态值，无法静态读取数据库素材';
        return undefined;
      }
      looksValue = this.scriptDataResolver.resolveItemFieldByIndex(
        document.fileName,
        item.itemIndex,
        'Looks',
        engine
      );
      if (looksValue === undefined) {
        item.message = `物品数据库中未找到 IDX ${item.itemIndex} 的 Looks`;
        return undefined;
      }
    } else if (item.mode === 'database-name') {
      if (!item.itemName) {
        item.message = '物品名称为动态值，无法静态读取数据库素材';
        return undefined;
      }
      looksValue = this.scriptDataResolver.resolveItemFieldByName(
        document.fileName,
        item.itemName,
        'Looks',
        engine
      );
      if (looksValue === undefined) {
        item.message = `物品数据库中未找到 ${item.itemName} 的 Looks`;
        return undefined;
      }
    } else if (item.mode === 'looks') {
      looksValue = item.looks;
    } else if (item.mode === 'direct-archive') {
      if (!item.archiveName || item.imageIndex === undefined) {
        item.message = '资源文件名或图片序号为动态值，无法静态预览';
        return undefined;
      }
      item.message = undefined;
      return {
        archiveName: item.archiveName,
        imageIndex: item.imageIndex,
      };
    } else {
      return undefined;
    }

    const sourceDynamic = item.dynamicFields?.includes('source') === true;
    const maximumLooks = engine === '996PC' ? 99999 : 65534;
    const reference = resolveItemImageReferenceForSource(
      looksValue,
      item.imageSource,
      sourceDynamic,
      maximumLooks
    );
    if (!reference) {
      if (sourceDynamic) {
        item.message = '物品内观素材来源是动态值，无法确定使用 Items 还是 StdItem';
        return undefined;
      }
      item.message = `Looks ${String(looksValue ?? '')} 超出 0-${maximumLooks} 或格式无效`;
      return undefined;
    }
    item.looks = reference.looks;
    item.message = undefined;
    return {
      archiveName: reference.pakName,
      imageIndex: reference.imageIndex,
    };
  }

  private resolveItemTooltipFields(
    item: DialogItemPreview,
    document: vscode.TextDocument,
    engine: EngineId
  ): DialogItemDatabaseFields {
    if (item.showTips !== true) return {};
    if (item.mode !== 'database-index' && item.mode !== 'database-name') return {};
    if (item.dynamicFields?.includes('itemid') || item.dynamicFields?.includes('itemname')) return {};
    const result: DialogItemDatabaseFields = {};
    for (const field of DIALOG_ITEM_TOOLTIP_DATABASE_FIELDS) {
      const value = item.mode === 'database-index' && item.itemIndex !== undefined
        ? this.scriptDataResolver.resolveItemFieldByIndex(
          document.fileName,
          item.itemIndex,
          field,
          engine
        )
        : item.itemName
          ? this.scriptDataResolver.resolveItemFieldByName(
            document.fileName,
            item.itemName,
            field,
            engine
          )
          : undefined;
      if (value !== undefined) result[field] = value;
    }
    return result;
  }

  private resolveAsset(
    reference: DialogAssetReference,
    engine: EngineId,
    webview: vscode.Webview,
    document: vscode.TextDocument,
    archiveCache: Map<string, CachedPatchPak>,
    assetTableCache: Map<string, CachedPatchAssetTable>,
    resolutionSnapshot?: DialogAssetResolutionSnapshot
  ): DialogAssetPreview {
    if (!isHydratableDialogAssetReference(reference)) {
      return { status: 'unsupported', message: '图片或资源序号为无效静态值' };
    }
    const workspaceRoot = workspaceRootForDocument(document);
    if (!workspaceRoot) return { status: 'missing', message: '未找到当前脚本所属工作区' };

    let archiveName = reference.archiveName?.trim();
    let archiveExtensions = uiEditorArchiveExtensions(engine);
    if (reference.archiveRole === 'game-ui-pack') {
      archiveName = configuredGameUiPackArchive(workspaceRoot);
      if (!archiveName) {
        return {
          status: 'missing',
          message: '登录器配置未找到 GameUIPack，无法确定 ListView 滑块素材文件',
        };
      }
    }
    if (reference.willIndex !== undefined) {
      const entry = loadPakIndex(workspaceRoot)?.pakList.find(item => item.willIdx === reference.willIndex);
      if (!entry) {
        return {
          status: 'missing',
          message: `EffectImageList.txt 未找到 WIL 序号 ${reference.willIndex}`,
        };
      }
      archiveName = entry.extension ? `${entry.name}.${entry.extension}` : entry.name;
      if (entry.extension) archiveExtensions = [entry.extension];
    }
    if (!archiveName) return { status: 'dynamic', message: '资源序号为动态值或未声明' };

    const index = reference.imageIndex!;
    const resourceRoots = resolutionSnapshot?.resourceRoots || (() => {
      const state = this.patchState(engine);
      return state ? clientResourceLayoutFromState(state)?.dataRoots || [] : [];
    })();
    let pak: CachedPatchPak | undefined;
    let match: ReturnType<typeof cachedPatchMatch>;
    if (resolutionSnapshot) {
      const selected = resolveCachedPatchArchiveByName(
        resolutionSnapshot.cacheRoot,
        archiveName,
        resolutionSnapshot.archiveFiles,
        resolutionSnapshot.resourceRoots,
        archiveExtensions
      );
      if (selected.status !== 'ready') {
        const message = selected.status === 'missing-source'
          ? `当前所选客户端资源目录中未找到 ${archiveName}`
          : selected.status === 'not-indexed'
            ? `当前所选素材包尚未建立缓存索引：${path.basename(selected.sourcePath)}`
            : `当前所选素材包缓存已过期：${path.basename(selected.sourcePath)}`;
        return {
          status: 'missing',
          archiveLabel: `${archiveName}/${String(index).padStart(6, '0')}`,
          message,
        };
      }
      const sourceKey = normalizedFilePath(selected.sourcePath);
      pak = archiveCache.get(sourceKey) || selected.pak;
      archiveCache.set(sourceKey, pak);
    } else {
      // Compatibility path for isolated tests that replace hydrateAssets or
      // invoke this private method without a production resolution snapshot.
      match = findCachedPatchImage(
        getPatchCacheRoot(this.context),
        archiveName,
        index,
        resourceRoots,
        archiveExtensions
      );
      pak = match?.pak;
    }
    if (!pak) {
      return {
        status: 'missing',
        archiveLabel: `${archiveName}/${String(index).padStart(6, '0')}`,
        message: '素材未缓存或缓存已失效',
      };
    }
    if (index >= pak.slotCount) {
      return {
        status: 'missing',
        archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
        message: `当前所选 ${pak.pakName} 只有 ${pak.slotCount} 个逻辑槽，图片序号 ${index} 越界`,
      };
    }
    const tableKey = pak.archiveId || pak.manifestPath;
    let table = assetTableCache.get(tableKey);
    try {
      if (!table) {
        table = loadCachedPatchAssetTable(pak);
        assetTableCache.set(tableKey, table);
      }
    } catch (error) {
      return {
        status: 'missing',
        archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
        message: `素材缓存索引无法读取：${errorMessage(error)}`,
      };
    }
    if (index >= table.slotCount || table.present[index] !== 1) {
      return {
        status: 'missing',
        archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
        message: '当前所选素材包的缓存索引中缺少该图片槽',
      };
    }
    if (table.blank[index] === 1) {
      return {
        status: 'missing',
        archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
        message: '当前所选素材包的该图片序号是空槽，不使用透明占位图',
      };
    }
    if (!match) match = cachedPatchMatch(pak, index);
    if (!match) {
      return {
        status: 'missing',
        archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
        message: '当前所选素材包的该图片缓存文件缺失',
      };
    }
    const uri = cachedPatchImageUri(match);
    const preview: DialogAssetPreview = {
      status: 'ready',
      url: webview.asWebviewUri(uri).toString(),
      archiveLabel: `${pak.pakName}/${String(index).padStart(6, '0')}`,
      width: table.width[index] || undefined,
      height: table.height[index] || undefined,
      offsetX: table.offsetX[index] || 0,
      offsetY: table.offsetY[index] || 0,
    };
    resolutionSnapshot?.previewPaks.set(preview, pak);
    return preview;
  }

  private patchState(engine: EngineId): SavedPatchManagerState | undefined {
    const state = this.context.workspaceState.get<SavedPatchManagerState>(patchManagerStateKey(engine))
      || this.context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
    return state && (!state.engine || state.engine === engine) ? state : undefined;
  }

  private async locateElement(session: NpcDialogSession, elementId: string): Promise<void> {
    const element = session.model.scenes
      .flatMap(scene => scene.elements)
      .find(candidate => candidate.id === elementId);
    if (!element) throw new Error('找不到对应源码，可能已经被修改');
    const source = dialogElementSource(session.model, element);
    const sourceDocument = source.uri === session.document.uri.toString()
      ? session.document
      : await vscode.workspace.openTextDocument(
        source.uri ? vscode.Uri.parse(source.uri) : vscode.Uri.file(source.filePath)
      );
    const range = new vscode.Range(
      sourceDocument.positionAt(element.sourceRange.start),
      sourceDocument.positionAt(element.sourceRange.end)
    );
    const editor = await vscode.window.showTextDocument(sourceDocument, {
      viewColumn: session.sourceViewColumn || vscode.ViewColumn.One,
      preserveFocus: false,
      selection: range,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async moveToFloatingWindow(session: NpcDialogSession): Promise<void> {
    if (session.floatingStarted) return;
    session.floatingStarted = true;
    await delay(350);
    if (!this.sessions.has(session.key)) return;
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(FLOATING_WINDOW_COMMAND)) {
      void session.panel.webview.postMessage({
        type: 'floatingFallback',
        message: '当前 VS Code 版本不支持独立浮动窗口，已在独立编辑标签中打开',
      });
      return;
    }
    try {
      session.panel.reveal(session.panel.viewColumn || vscode.ViewColumn.Beside, false);
      await vscode.commands.executeCommand(FLOATING_WINDOW_COMMAND);
    } catch (error) {
      console.warn('[BOO] NPC界面移入浮动窗口失败:', errorMessage(error));
      void session.panel.webview.postMessage({
        type: 'floatingFallback',
        message: '自动移入浮动窗口失败，可右键此标签选择“移动到新窗口”',
      });
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    for (const session of this.sessions.values()) {
      const primaryChanged = session.document.uri.toString() === event.document.uri.toString();
      const companionChanged = this.isCompanionSource(session, event.document.uri);
      if ((!primaryChanged && !companionChanged) || (primaryChanged && session.applying)) continue;
      if (session.dirty) {
        session.conflict = true;
        void session.panel.webview.postMessage({
          type: 'conflict',
          message: companionChanged && !primaryChanged
            ? '外部 QFunction-0.txt 在可视化草稿期间发生变化，请重新载入后继续'
            : '源码在可视化草稿期间发生变化，请重新载入后继续',
        });
      } else {
        void this.reloadSession(session, false);
      }
    }
  }

  private onCompanionFileChanged(uri: vscode.Uri): void {
    for (const session of this.sessions.values()) {
      const action = dialogCompanionSourceChangeAction(
        session.model,
        uri.fsPath,
        session.dirty
      );
      if (action === 'ignore') continue;
      if (action === 'conflict') {
        session.conflict = true;
        void session.panel.webview.postMessage({
          type: 'conflict',
          message: '外部 QFunction-0.txt 文件已变化，请重新载入后继续',
        });
      } else {
        void this.reloadSession(session, false);
      }
    }
  }

  private isCompanionSource(session: NpcDialogSession, uri: vscode.Uri): boolean {
    return isDialogCompanionModelSource(session.model, uri.fsPath);
  }

  private onDocumentClosed(document: vscode.TextDocument): void {
    for (const session of this.sessions.values()) {
      if (session.document.uri.toString() === document.uri.toString()) {
        session.conflict = true;
        void session.panel.webview.postMessage({
          type: 'conflict',
          message: '源文件已关闭，请重新打开源文件后重新载入',
        });
      } else if (this.isCompanionSource(session, document.uri)) {
        if (session.dirty) {
          session.conflict = true;
          void session.panel.webview.postMessage({
            type: 'conflict',
            message: '外部 QFunction-0.txt 已关闭，当前草稿需要重新载入后再继续',
          });
        } else {
          void this.reloadSession(session, false);
        }
      }
    }
  }

  private disposeSession(session: NpcDialogSession): void {
    this.sessions.delete(session.key);
    session.disposables.splice(0).forEach(disposable => disposable.dispose());
  }

  private webviewHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.html');
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.css'))
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.js'))
    );
    const html = fs.readFileSync(htmlPath, 'utf8')
      .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
      .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString());
    return secureWebviewHtml(webview, html);
  }
}

function workspaceRootForDocument(document: vscode.TextDocument): string | undefined {
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function normalizedFilePath(filePath: string): string {
  return path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
}

function findFunctionLabelOffset(text: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\uFEFF?\\s*\\[${escaped}\\]`, 'im').exec(text);
  return match?.index;
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) throw new Error('坐标修正必须是整数');
  const result = Math.trunc(value!);
  if (Math.abs(result) > 10000) throw new Error('坐标修正超出允许范围');
  return result;
}

function isFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

async function validateExactDialogAssetIdentities(
  requiredPreviews: ReadonlySet<DialogAssetPreview>,
  snapshot: DialogAssetResolutionSnapshot
): Promise<void> {
  const requiredPaks = new Map<string, CachedPatchPak>();
  for (const preview of requiredPreviews) {
    if (preview.status !== 'ready' || !preview.url) continue;
    const pak = snapshot.previewPaks.get(preview);
    if (!pak) continue;
    requiredPaks.set(cachedPatchIdentity(pak), pak);
  }

  for (const [identity, pak] of requiredPaks) {
    let failure = '';
    if (!/^[a-f0-9]{32}$/i.test(pak.sourceMd5 || '')) {
      // Computing the current source MD5 cannot prove that an old cache was
      // built from those bytes. Such a cache must be rebuilt once.
      failure = '素材包缓存未记录可核对的 MD5 身份，请重新缓存';
    } else {
      const validation = await validatePatchCacheMd5(pak);
      if (!validation.current) {
        failure = validation.reason === 'changed' || validation.reason === 'metadata-changed'
          ? '素材包内容与缓存索引不一致（MD5 身份校验失败），请重新缓存'
          : `素材包身份校验失败或缓存已过期（${validation.reason}）`;
      }
    }
    if (!failure) continue;

    // Once an ITEMSHOW proves that a selected package is stale, every preview
    // resolved from that same package in this hydrate session is unsafe.
    for (const [preview, resolvedPak] of snapshot.previewPaks) {
      if (cachedPatchIdentity(resolvedPak) !== identity) continue;
      preview.status = 'missing';
      preview.message = failure;
      delete preview.url;
      delete preview.width;
      delete preview.height;
      delete preview.offsetX;
      delete preview.offsetY;
    }
  }
}

function cachedPatchIdentity(pak: CachedPatchPak): string {
  return pak.archiveId || normalizedFilePath(pak.manifestPath);
}

function cachedPatchMatch(
  pak: CachedPatchPak,
  imageIndex: number
): { pak: CachedPatchPak; imagePath: string; archiveId?: string; imageIndex: number } | undefined {
  if (pak.storageMode === 'direct' && pak.archiveId) {
    return { pak, imagePath: '', archiveId: pak.archiveId, imageIndex };
  }
  const imagePath = patchImagePath(pak, imageIndex);
  return imagePath && isFile(imagePath) ? { pak, imagePath, imageIndex } : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
