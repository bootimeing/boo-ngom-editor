import { EngineId } from '../types';

export interface SourceSpan {
  start: number;
  end: number;
  original: string;
}

export type DialogCoordinateMode = 'absolute' | 'relative' | 'anchored' | 'flow' | 'none';

export type DialogConditionOperator = 'AND' | 'OR';

export interface DialogConditionGroup {
  id: string;
  sourceLabel: string;
  title: string;
  conditions: string[];
  operators: DialogConditionOperator[];
  satisfied: boolean;
}

export interface DialogResolvedVariable {
  name: string;
  value: string;
  status: 'resolved' | 'default';
  /** Exact static evidence that may safely feed ITEMSHOW's StdItems IDX lookup. */
  staticValueSource?: 'database-item-index';
  sourceLabel?: string;
  sourceLine?: number;
  sourceReferences?: DialogVariableSourceReference[];
}

export interface DialogVariableSourceReference {
  sourceLabel: string;
  sourceLine: number;
}

export type DialogElementKind =
  | 'text'
  | 'image'
  | 'button'
  | 'animation'
  | 'input'
  | 'progress'
  | 'item'
  | 'menu'
  | 'container'
  | 'monster'
  | 'generic'
  | 'unknown';

export interface DialogAssetReference {
  willIndex?: number;
  archiveName?: string;
  archiveRole?: 'game-ui-pack';
  imageIndex?: number;
  frameCount?: number;
}

export interface DialogAssetPreview {
  status: 'ready' | 'missing' | 'dynamic' | 'unsupported';
  url?: string;
  archiveLabel?: string;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  message?: string;
}

export type DialogAssetLayerRole =
  | 'background'
  | 'item'
  | 'progress'
  | 'thumb'
  | 'selected'
  | 'arrow'
  | 'list-background'
  | 'scrollbar'
  | 'scroll-start'
  | 'scroll-start-hover'
  | 'scroll-start-pressed'
  | 'scroll-thumb'
  | 'scroll-thumb-hover'
  | 'scroll-thumb-pressed'
  | 'scroll-end'
  | 'scroll-end-hover'
  | 'scroll-end-pressed'
  | 'hover'
  | 'pressed';

export interface DialogAssetLayer {
  role: DialogAssetLayerRole;
  assetRef: DialogAssetReference;
  asset?: DialogAssetPreview;
}

export type DialogAssetStateRole = 'normal' | 'hover' | 'pressed' | 'selected';
export type DialogAssetStateStatus = 'static' | 'dynamic' | 'invalid' | 'missing';

export interface DialogAssetStateDiagnostic {
  role: DialogAssetStateRole;
  status: DialogAssetStateStatus;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
}

export interface DialogElementParameter {
  index?: number;
  key?: string;
  name: string;
  value: string;
}

export type DialogItemPreviewMode =
  | 'database-index'
  | 'database-name'
  | 'equipment'
  | 'hero-equipment'
  | 'unique-item'
  | 'empty-box'
  | 'direct-archive'
  | 'looks';

export type DialogItemPreviewField =
  | 'itemid'
  | 'itemname'
  | 'itemcount'
  | 'index'
  | 'makeindex'
  | 'color'
  | 'grey'
  | 'lock'
  | 'bgtype'
  | 'scale'
  | 'align'
  | 'customwidth'
  | 'title'
  | 'source'
  | 'effect'
  | 'target'
  | 'light'
  | 'unit'
  | 'showtips'
  | 'showstar'
  | 'effectshow'
  | 'boxindex'
  | 'background'
  | 'interior'
  | 'stdmode';

export interface DialogItemPreview {
  mode: DialogItemPreviewMode;
  itemIndex?: number;
  itemName?: string;
  equipmentSlot?: number;
  uniqueIndex?: number;
  looks?: number;
  archiveName?: string;
  imageIndex?: number;
  quantity?: number;
  quantityColor?: string;
  gray?: boolean;
  locked?: boolean;
  scale?: number;
  align?: 'natural' | 'custom-width';
  customWidth?: number;
  titleMode?: boolean;
  imageSource?: 'items' | 'std-item';
  drawEffect?: boolean;
  lightCode?: number;
  compactQuantity?: boolean;
  displayTarget?: 'self' | 'viewed-character';
  showTips?: boolean;
  showStar?: boolean;
  effectShow?: 0 | 1 | 2;
  boxIndex?: number;
  allowedStdModes?: number[];
  acceptsAnyStdMode?: boolean;
  backgroundDisabled?: boolean;
  /** CustomItem/HeroCustomItem interior switch; actual equipment content is runtime-only. */
  showInterior?: boolean;
  frameValue?: number;
  label: string;
  message?: string;
  dynamic?: boolean;
  dynamicFields?: DialogItemPreviewField[];
  invalidFields?: DialogItemPreviewField[];
}

export interface DialogCostItemPreview {
  title: string;
  titleUsesClientDefault: boolean;
  titleColor?: string;
  quantityText: string;
  quantityColor?: string;
  fontSize?: number;
  itemScale: number;
  dynamic?: boolean;
}

export type DialogProgressPreviewField =
  | 'archive'
  | 'background-image'
  | 'progress-image'
  | 'thumb-image'
  | 'minimum'
  | 'maximum'
  | 'value'
  | 'direction'
  | 'offset-x'
  | 'offset-y'
  | 'frame-count'
  | 'frame-interval'
  | 'end-value'
  | 'value-interval'
  | 'value-step'
  | 'visibility'
  | 'caption-color'
  | 'caption-offset-x'
  | 'caption-offset-y'
  | 'font-size'
  | 'outline-width'
  | 'outline-color'
  | 'text';

export interface DialogProgressPreview {
  minimum?: number;
  maximum?: number;
  value?: number;
  ratio?: number;
  direction?: number;
  offsetX: number;
  offsetY: number;
  text?: string;
  frameCount?: number;
  frameInterval?: number;
  endValue?: number;
  valueIntervalMs?: number;
  valueStep?: number;
  captionMode?: 'template' | 'percent';
  captionColor?: string;
  captionOffsetX: number;
  captionOffsetY: number;
  fontSize?: number;
  outlineWidth?: number;
  outlineColor?: string;
  defaultFields?: DialogProgressPreviewField[];
  dynamicFields?: DialogProgressPreviewField[];
  invalidFields?: DialogProgressPreviewField[];
  showCaption?: boolean;
}

export type DialogInputMode =
  | 'text'
  | 'number'
  | 'memo'
  | 'password'
  | 'absolute-number';

export type DialogInputPreviewField =
  | 'mode'
  | 'input-id'
  | 'placeholder'
  | 'placeholder-color'
  | 'text-color'
  | 'background-color'
  | 'border-color'
  | 'font-size'
  | 'min-length'
  | 'max-length'
  | 'min-value'
  | 'max-value'
  | 'line-height'
  | 'auto-wrap'
  | 'only-chinese'
  | 'show-background'
  | 'error-tips';

export interface DialogInputPreview {
  mode: DialogInputMode;
  inputId?: number;
  placeholder?: string;
  placeholderColor?: string;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  transparentBackground?: boolean;
  borderless?: boolean;
  fontSize?: number;
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  lineHeight?: number;
  autoWrap?: boolean;
  onlyChinese?: boolean;
  showBackground?: boolean;
  errorTips?: string;
  dynamic?: boolean;
  dynamicFields?: DialogInputPreviewField[];
  invalidFields?: DialogInputPreviewField[];
}

export interface DialogTogglePreview {
  /** Backward-compatible static initial state. Undefined means runtime/dynamic. */
  checked?: boolean;
  initialChecked?: boolean;
  variableName?: string;
  submitMode?: string;
  delayMs?: number;
  repeatCount?: number;
  link?: string;
  dynamicFields?: Array<'checked' | 'variable' | 'submit' | 'delay' | 'count' | 'link'>;
  invalidFields?: Array<'checked' | 'delay' | 'count'>;
}

export interface DialogSliderPreview {
  minimum: number;
  maximum?: number;
  initialValue?: number;
  variableName?: string;
  link?: string;
  defaultFields?: Array<'maximum' | 'value'>;
  dynamicFields?: Array<
    | 'archive' | 'background-image' | 'progress-image' | 'thumb-image'
    | 'maximum' | 'value' | 'variable' | 'link'
  >;
  invalidFields?: Array<
    | 'archive' | 'background-image' | 'progress-image' | 'thumb-image'
    | 'maximum' | 'value' | 'variable' | 'link'
  >;
}

export type DialogRuntimeActionField =
  | 'submit-inputs'
  | 'link'
  | 'link-parameters'
  | 'double-click-link'
  | 'reload'
  | 'delay'
  | 'count';

export type DialogRuntimeActionTrigger =
  | 'click'
  | 'double-click'
  | 'change'
  | 'completion'
  | 'automatic';

/**
 * Client/server actions retained for an auditable local simulation. The Webview
 * must never execute script labels, reload the real client, or submit values.
 */
export interface DialogRuntimeActionPreview {
  /** Explicit when the manual proves a gesture/event; omitted for older keyed controls. */
  trigger?: DialogRuntimeActionTrigger;
  submitInputIds?: number[];
  link?: string;
  /** Source-order SCRIPTPARAM1..N values. They are displayed, never submitted. */
  parameters?: string[];
  doubleClickLink?: string;
  reload?: boolean;
  delay?: number;
  count?: number;
  delayUnit?: 'manual-unspecified';
  localOnly: true;
  dynamicFields?: DialogRuntimeActionField[];
  invalidFields?: DialogRuntimeActionField[];
}

export interface DialogAddButtonDeleteAction {
  buttonId?: number;
  sourceLabel: string;
  lineNumber: number;
  dynamic: boolean;
  scope?: 'self' | 'all-users';
  scopeDynamic?: boolean;
  invalid?: boolean;
}

export interface DialogAddButtonEffectPreview {
  state: 'normal' | 'hover' | 'pressed';
  assetRef?: DialogAssetReference;
  frameCount?: number;
  frameIntervalMs?: number;
  drawMode?: number;
  offsetX?: number;
  offsetY?: number;
  /** Consecutive, time-slot-preserving frames hydrated by the provider. */
  frames?: DialogAssetPreview[];
  dynamicFields?: string[];
  invalidFields?: string[];
}

/**
 * #ACT-created client buttons retained as a read-only, local-only preview.
 * Engine-specific fields deliberately stay separate so a GEE create position
 * or 996PC movable switch can never be mislabeled as a GOM group.
 */
export interface DialogAddButtonPreview {
  command: 'ADDBUTTON' | 'ADDBUTTONEX';
  engine: EngineId;
  status: 'partial-simulation' | 'dynamic' | 'invalid' | 'evidence-blocked';
  triggerId?: number;
  movable?: boolean;
  groupId?: number;
  createPosition?: number;
  createPositionLabel?: string;
  localOnly: true;
  effects?: DialogAddButtonEffectPreview[];
  deleteActions: DialogAddButtonDeleteAction[];
  dynamicFields: string[];
  invalidFields: string[];
}

export interface DialogTextRun {
  text: string;
  color?: string;
  colorValues?: string[];
  colorFrames?: string[];
  colorIntervalMs?: number;
}

export type DialogTextPreviewField =
  | 'text'
  | 'simplify-number'
  | 'color'
  | 'font-size'
  | 'font-family'
  | 'font-bold'
  | 'gray'
  | 'outline-width'
  | 'outline-color'
  | 'scroll-width'
  | 'scroll-height'
  | 'scroll-direction'
  | 'scroll-duration';

export type DialogTextValueStatus =
  | 'literal'
  | 'resolved-static'
  | 'runtime-placeholder'
  | 'invalid-static';

export interface DialogDisplayValueSource {
  /** Stable surface-local field name, for example `input.placeholder`. */
  field: string;
  kind: 'text' | 'number';
  /** Exact source expression retained for Inspector and audit. */
  expression: string;
  status: DialogTextValueStatus;
  /** The safe value actually presented by the offline canvas. */
  value: string | number;
  variableNames?: string[];
}

export interface DialogTextFieldSourceDiagnostic {
  field: DialogTextPreviewField;
  /** Exact source-side field expression retained for Inspector/audit. */
  expression: string;
  status: DialogTextValueStatus;
  variableNames?: string[];
}

export interface DialogTextPreview {
  lines: DialogTextRun[][];
  fontSize?: number;
  /** Exact FNAME source request. No substitute font is inferred by the model. */
  fontFamily?: string;
  bold?: boolean;
  color?: string;
  outlineWidth?: number;
  outlineColor?: string;
  align?: 'left' | 'center';
  gray?: boolean;
  simplifyNumber?: boolean;
  /** Unit choice is documented, but fractional precision is only a preview policy. */
  simplifyNumberApproximate?: boolean;
  colorValues?: string[];
  colorFrames?: string[];
  colorIntervalMs?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  scrollDirection?: 0 | 1;
  scrollDurationMs?: number;
  /** Original visible-text expression retained for Inspector/source audit. */
  sourceText?: string;
  /** Whether the visible value is proven on the selected path or is a neutral placeholder. */
  textValueStatus?: DialogTextValueStatus;
  /** Per-field provenance keeps a proven style independent from unknown text/scroll fields. */
  fieldSources?: DialogTextFieldSourceDiagnostic[];
  /** Runtime-looking source fields whose values were proven on the selected static path. */
  resolvedFields?: DialogTextPreviewField[];
  dynamicFields?: DialogTextPreviewField[];
  invalidFields?: Array<
    | 'color'
    | 'simplify-number'
    | 'font-size'
    | 'font-family'
    | 'font-bold'
    | 'gray'
    | 'outline-width'
    | 'outline-color'
    | 'scroll-width'
    | 'scroll-height'
    | 'scroll-direction'
    | 'scroll-duration'
  >;
}

export type DialogMenuAssetField = 'img' | 'arrowimg' | 'selectimg' | 'listimg';
export type DialogMenuAssetStatus = 'default' | 'static' | 'dynamic' | 'invalid' | 'missing';

export interface DialogMenuAssetDiagnostic {
  field: DialogMenuAssetField;
  role: 'background' | 'arrow' | 'selected' | 'list-background';
  /** Source classification remains stable even when hydration later reports missing. */
  sourceStatus: Exclude<DialogMenuAssetStatus, 'missing'>;
  status: DialogMenuAssetStatus;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
  message?: string;
}

export interface DialogMenuPreview {
  items: string[];
  selected: string;
  /** 996PC server-side selection target. Ctrl+F12 only mirrors it in local preview state. */
  menuId?: string;
  /** Documented server script target; retained for display and never executed by the preview. */
  link?: string;
  direction: 0 | 1;
  itemHeight: number;
  maxHeight?: number;
  fontColor?: string;
  selectedColor?: string;
  assetDiagnostics: DialogMenuAssetDiagnostic[];
  dynamic?: boolean;
  defaultFields?: Array<'direction' | 'itemhei' | DialogMenuAssetField>;
  dynamicFields?: Array<
    | 'itemname'
    | 'select'
    | 'direction'
    | 'itemhei'
    | 'maxhei'
    | 'fontcolor'
    | 'selectcolor'
    | 'img'
    | 'arrowimg'
    | 'selectimg'
    | 'listimg'
    | 'menuid'
    | 'link'
  >;
  invalidFields?: Array<
    | 'direction'
    | 'itemhei'
    | 'maxhei'
    | 'menuid'
    | DialogMenuAssetField
  >;
}

export type DialogCountdownFormat =
  | 'legacy-fixed'
  | 'legacy-compact'
  | 'seconds'
  | 'pc-seconds'
  | 'pc-smart'
  | 'pc-dhms';

export interface DialogCountdownPreview {
  seconds?: number;
  repeatCount?: number;
  format: DialogCountdownFormat;
  dynamic: boolean;
  initialText: string;
  link?: string;
  dynamicFields?: Array<'seconds' | 'repeat' | 'format' | 'link'>;
  invalidFields?: Array<'seconds' | 'repeat' | 'format'>;
}

export interface DialogImageGlyph {
  character: string;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
  sourceX?: number;
}

export type DialogImageTextField =
  | 'archive'
  | 'image'
  | 'glyph-width'
  | 'glyph-height'
  | 'text';

export type DialogImageTextAssetContract =
  | 'unverified'
  | 'matched'
  | 'mismatch'
  | 'unavailable'
  | 'blocked';

export interface DialogImageTextPreview {
  mode: 'individual' | 'atlas';
  textAtlasVariant?: 'legacy-individual' | 'newui-atlas';
  value: string;
  gap: number;
  glyphWidth?: number;
  glyphHeight?: number;
  /** Statically proven first digit image (legacy) or whole digit sheet (new UI). */
  baseAssetRef?: DialogAssetReference;
  assetContract?: DialogImageTextAssetContract;
  assetContractMessage?: string;
  dynamicFields?: DialogImageTextField[];
  invalidFields?: DialogImageTextField[];
  glyphs: DialogImageGlyph[];
  /** Complete runtime glyph set for image countdowns (0-9 and colon). */
  glyphBank?: DialogImageGlyph[];
}

export interface DialogImageTitle {
  raw: string;
  text: string;
  offsetX: number;
  offsetY: number;
  colorValue: string;
  color: string;
}

export type DialogImagePreviewField =
  | 'opacity'
  | 'gray'
  | 'background'
  | 'escape-close'
  | 'move'
  | 'reset'
  | 'load-delay'
  | 'hide-main'
  | 'forbid-bag-equip'
  | 'bag-position'
  | 'reload'
  | 'show-position'
  | 'layer-id'
  | 'scale9-left'
  | 'scale9-right'
  | 'scale9-top'
  | 'scale9-bottom'
  | 'title'
  | 'submit'
  | 'link';

export interface DialogImageDirectPathPreview {
  raw: string;
  normalized?: string;
  status: 'evidence-blocked' | 'blocked' | 'invalid';
}

export interface DialogImagePreview {
  variant: 'newui-img-996pc' | 'gom-img' | 'gom-imgex';
  opacity?: number;
  gray?: boolean;
  /** GOM image title parsed from `text,x,y,color#`; never a hover tooltip. */
  title?: DialogImageTitle;
  /** IMGEX parameter 7, retained separately from parameter 8 title text. */
  submitIds?: string;
  /** Click target retained for preview metadata; Ctrl+F12 does not execute it. */
  link?: string;
  background?: boolean;
  escapeClose?: boolean;
  movable?: boolean;
  resetPosition?: boolean;
  loadDelay?: boolean;
  hideMain?: boolean;
  forbidBagEquip?: boolean;
  bagPosition?: 0 | 1;
  reload?: boolean;
  layerId?: number;
  localOnly?: true;
  runtimeScope?: 'local-only';
  directPathPreview?: DialogImageDirectPathPreview;
  showPosition?: 0 | 1 | 2 | 3 | 4;
  scale9?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  defaultFields?: DialogImagePreviewField[];
  dynamicFields?: DialogImagePreviewField[];
  invalidFields?: DialogImagePreviewField[];
  dynamic?: boolean;
}

export type DialogModelLayerRole =
  | 'cloth'
  | 'weapon'
  | 'head'
  | 'cap'
  | 'shield'
  | 'veil';

export interface DialogModelLayer {
  role: DialogModelLayerRole;
  label: string;
  looks: number;
  assetRef: DialogAssetReference;
  asset?: DialogAssetPreview;
}

export interface DialogModelBounds {
  /** Unscaled bounds in the model-origin coordinate system. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Display dimensions after DialogModelPreview.scale is applied. */
  width: number;
  height: number;
}

export type DialogModelField =
  | 'sex'
  | 'scale'
  | 'cloth-id'
  | 'weapon-id'
  | 'head-id'
  | 'cap-id'
  | 'shield-id'
  | 'veil-id'
  | 'hair-id'
  | 'not-show-mold'
  | 'not-show-hair'
  | 'cloth-effect'
  | 'weapon-effect'
  | 'head-effect'
  | 'cap-effect'
  | 'shield-effect'
  | 'veil-effect';

export interface DialogModelPreview {
  variant: 'ui-model-996pc';
  sex?: number;
  scale: number;
  layers: DialogModelLayer[];
  hairId?: number;
  notShowMold?: boolean;
  notShowHair?: boolean;
  /** Raw, auditable UIModel effect configuration; no asset mapping is inferred. */
  effectConfigs?: Partial<Record<DialogModelLayerRole, string>>;
  dynamicFields?: DialogModelField[];
  invalidFields?: DialogModelField[];
  bounds?: DialogModelBounds;
}

export interface DialogMonsterPreview {
  variant: 'gom' | 'gee';
  status: 'static-representative' | 'smart-monster-unresolved' | 'dynamic' | 'invalid';
  appr?: number;
  race?: number;
  raceImg?: number;
  action?: number;
  displayMode?: number;
  direction?: number;
  message: string;
}

export type DialogAnimationField =
  | 'resource'
  | 'start'
  | 'frame-count'
  | 'interval'
  | 'repeat'
  | 'finish-frame'
  | 'finish-hide'
  | 'scale'
  | 'draw-mode'
  | 'repair-mode'
  | 'caption'
  | 'submit'
  | 'slow-count'
  | 'link';

export interface DialogAnimationBounds {
  /** Unscaled bounds relative to the animation statement origin. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Display dimensions after DialogAnimationPreview.scale is applied. */
  width: number;
  height: number;
}

export interface DialogAnimationTitle {
  raw: string;
  text: string;
  offsetX: number;
  offsetY: number;
  colorValue: string;
  color: string;
}

export interface DialogAnimationPreview {
  variant: 'gom-playimg' | 'gom-playimgex' | 'lfm-playimg' | 'lfm-playimgex'
    | '996pc-playimg' | '996pc-frames' | '996pc-effect';
  frameCount: number;
  /** Documented/source interval. Browser safety limiting is kept separately. */
  intervalMs: number;
  previewIntervalMs: number;
  repeatCount?: number;
  finishFrame?: number;
  finishFrameIndexBasis?: 'unknown';
  finishHide?: boolean;
  scale?: number;
  drawMode?: number;
  repairMode?: number;
  repairModeEvidence?: 'official' | 'update-log';
  offsetPolicy: 'ignore' | 'asset' | 'switch';
  finiteCompletion: 'hide' | 'frames-policy' | 'unknown';
  caption?: string;
  /** GOM image title parsed from `text,x,y,color#`; distinct from LFM tooltip text. */
  title?: DialogAnimationTitle;
  submitIds?: string;
  slowCount?: number;
  link?: string;
  /** Dynamic/invalid timing never starts a timer; the first requested slot stays visible. */
  staticFirstFrameOnly?: boolean;
  /** finishframe+finishhide precedence is not published by the 996PC manual. */
  finishPolicyConflict?: boolean;
  bounds?: DialogAnimationBounds;
  /** Present in source but not documented for this specific control. */
  unverifiedFields?: string[];
  dynamicFields?: DialogAnimationField[];
  invalidFields?: DialogAnimationField[];
}

export interface DialogTooltipRun {
  text: string;
  color?: string;
}

export interface DialogTooltipPreview {
  raw: string;
  kind: 'text' | 'item';
  lines: DialogTooltipRun[][];
  offsetX: number;
  offsetY: number;
  itemIndex?: number;
  itemMode?: number;
}

export type DialogItemGridSource =
  | 'character-bag'
  | 'hero-bag'
  | 'character-equipment'
  | 'hero-equipment';

export type DialogItemGridField =
  | 'condition'
  | 'positions'
  | 'select'
  | 'count'
  | 'row'
  | 'iwidth'
  | 'iheight'
  | 'selecttype'
  | 'showstar'
  | 'showtips'
  | 'conditionEx'
  | 'conditionParam'
  | 'conditionOnOff'
  | 'exclude'
  | 'filter1'
  | 'filter2'
  | 'filter3'
  | 'exbind';

export type DialogListViewField =
  | 'gap'
  | 'margin'
  | 'default'
  | 'direction'
  | 'remember-scroll-position'
  | 'reserved-3'
  | 'reserved-4'
  | 'reserved-5'
  | 'cantouch'
  | 'bounce'
  | 'slider';

export type DialogListViewSourceStatus =
  | 'static'
  | 'dynamic'
  | 'invalid'
  | 'missing'
  | 'default'
  | 'disabled'
  | 'reserved';

export interface DialogListViewFieldDiagnostic {
  field: DialogListViewField;
  sourceStatus: DialogListViewSourceStatus;
  status: DialogListViewSourceStatus;
  rawSource?: string;
  message?: string;
}

export interface DialogListViewScrollbarDiagnostic {
  field: string;
  role: Extract<DialogAssetLayerRole,
    | 'scrollbar'
    | 'scroll-start'
    | 'scroll-start-hover'
    | 'scroll-start-pressed'
    | 'scroll-thumb'
    | 'scroll-thumb-hover'
    | 'scroll-thumb-pressed'
    | 'scroll-end'
    | 'scroll-end-hover'
    | 'scroll-end-pressed'>;
  sourceStatus: DialogListViewSourceStatus;
  status: DialogListViewSourceStatus;
  rawSource?: string;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
  message?: string;
}

export type DialogContainerField = DialogItemGridField | DialogListViewField;

export interface DialogContainerPreview {
  variant: 'layout' | 'list' | 'line-break' | 'item-grid';
  label: string;
  borderColor?: string;
  fillColor?: string;
  direction?: 'vertical' | 'horizontal';
  gap?: number;
  defaultIndex?: number;
  requestedDefaultIndex?: number;
  effectiveDefaultIndex?: number;
  rememberScrollPosition?: boolean;
  localOnly?: true;
  interactionStatus?: 'local-only' | 'blocked-dynamic' | 'blocked-invalid' | 'disabled';
  reservedFields?: DialogListViewField[];
  viewportClipped?: boolean;
  touchEnabled?: boolean;
  bounce?: number;
  scrollOffset?: number;
  contentWidth?: number;
  contentHeight?: number;
  scrollbarMode?: 'custom' | 'client-default' | 'disabled' | 'blocked';
  scrollbarDynamic?: boolean;
  fieldDiagnostics?: DialogListViewFieldDiagnostic[];
  scrollbarDiagnostics?: DialogListViewScrollbarDiagnostic[];
  cellCount?: number;
  columns?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
  cellGap?: number;
  gridSource?: DialogItemGridSource;
  filterCondition?: string;
  equipmentPositions?: string;
  selectedUniqueIds?: string[];
  selectionMode?: 'multi' | 'single';
  showTips?: boolean;
  showStar?: boolean;
  filterStar?: boolean;
  starLevel?: number;
  starCondition?: 0 | 1;
  excludedUniqueIds?: string[];
  excludedItemIds?: string[];
  excludedItemNames?: string[];
  includedItemRefs?: string[];
  excludeBound?: boolean;
  defaultFields?: DialogContainerField[];
  dynamicFields?: DialogContainerField[];
  invalidFields?: DialogContainerField[];
  dynamic?: boolean;
}

export interface DialogLayoutPreview {
  anchor?: number;
  anchorX?: number;
  anchorY?: number;
  percentX?: number;
  percentY?: number;
  percentWidth?: number;
  percentHeight?: number;
  /** GOM traditional Text `*`, `*30`, and `*-30` center syntax. */
  legacyCenterX?: boolean;
  legacyCenterY?: boolean;
  legacyCenterOffsetX?: number;
  legacyCenterOffsetY?: number;
  legacyCenterDynamicAxes?: Array<'x' | 'y'>;
  legacyCenterInvalidAxes?: Array<'x' | 'y'>;
  positionDynamic?: boolean;
  sizeDynamic?: boolean;
  dynamic?: boolean;
}

export type DialogSizeMode =
  | 'explicit'
  | 'percent'
  | 'derived'
  | 'intrinsic'
  | 'dynamic'
  | 'default';

export interface DialogSizeAxisPreview {
  mode: DialogSizeMode;
  baseValue: number;
}

export interface DialogSizePreview {
  width: DialogSizeAxisPreview;
  height: DialogSizeAxisPreview;
}

export interface DialogCoordinate {
  sourceValue: number;
  displayValue: number;
  span: SourceSpan;
}

export type DialogCoordinateBindingTarget =
  | 'adddlg-window-origin'
  | 'adddlg-content-origin'
  | 'dialog-background-offset';

/**
 * A source-bound coordinate pair that is not itself a regular canvas element.
 * Its physical document provenance prevents a companion span from being
 * mistaken for a writable range in the primary NPC document.
 */
export interface DialogCoordinateBinding {
  id: string;
  targetKind: DialogCoordinateBindingTarget;
  sourceRange: SourceSpan;
  sourceUri: string;
  sourceFilePath: string;
  sourceDocumentVersion: number;
  editable: boolean;
  x: DialogCoordinate;
  y: DialogCoordinate;
}

export interface DialogElement {
  id: string;
  statementId: string;
  token: string;
  description: string;
  kind: DialogElementKind;
  raw: string;
  lineNumber: number;
  sourceRange: SourceSpan;
  /** Source document for companion-backed elements; omitted for the primary document. */
  sourceUri?: string;
  sourceFilePath?: string;
  sourceDocumentVersion?: number;
  coordinateMode: DialogCoordinateMode;
  sourceCoordinateBiasX: number;
  sourceCoordinateBiasY: number;
  editable: boolean;
  x?: DialogCoordinate;
  y?: DialogCoordinate;
  localLayoutX: number;
  localLayoutY: number;
  layoutX: number;
  layoutY: number;
  width: number;
  height: number;
  text?: string;
  color?: string;
  parameters?: DialogElementParameter[];
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
  assetLayers?: DialogAssetLayer[];
  assetStateDiagnostics?: DialogAssetStateDiagnostic[];
  animationPreview?: DialogAnimationPreview;
  animationFrames?: DialogAssetPreview[];
  tooltipPreview?: DialogTooltipPreview;
  itemPreview?: DialogItemPreview;
  costItemPreview?: DialogCostItemPreview;
  progressPreview?: DialogProgressPreview;
  sliderPreview?: DialogSliderPreview;
  runtimeActionPreview?: DialogRuntimeActionPreview;
  addButtonPreview?: DialogAddButtonPreview;
  inputPreview?: DialogInputPreview;
  togglePreview?: DialogTogglePreview;
  textPreview?: DialogTextPreview;
  menuPreview?: DialogMenuPreview;
  countdownPreview?: DialogCountdownPreview;
  imageTextPreview?: DialogImageTextPreview;
  imagePreview?: DialogImagePreview;
  modelPreview?: DialogModelPreview;
  monsterPreview?: DialogMonsterPreview;
  containerPreview?: DialogContainerPreview;
  layoutPreview?: DialogLayoutPreview;
  sizePreview?: DialogSizePreview;
  /** Per-field display provenance, independent from resource/runtime gates. */
  displayValueSources?: DialogDisplayValueSource[];
  containerElementId?: string;
  containerParentId?: string;
  containerChildIds?: string[];
  parentElementId?: string;
  warning?: string;
}

export interface DialogBackground {
  command: 'OPENMERCHANTBIGDLG' | 'OPENBIGDIALOGBOX';
  status: 'static' | 'dynamic' | 'invalid';
  raw: string;
  lineNumber: number;
  sourceRange?: SourceSpan;
  sourceUri?: string;
  sourceFilePath?: string;
  sourceDocumentVersion?: number;
  willIndex?: number;
  imageIndex?: number;
  movable?: boolean;
  position?: 0 | 1 | 2 | 3 | 4;
  offsetX?: number;
  offsetY?: number;
  offsetBinding?: DialogCoordinateBinding;
  showCloseButton?: boolean;
  closeButtonX?: number;
  closeButtonY?: number;
  /** GOM/996PC merchant tail; never inferred for GEE or OpenBigDialogBox. */
  independentWindow?: boolean;
  /** LFM/GEE merchant tail; deliberately distinct from independentWindow. */
  continueUse?: boolean;
  nineGrid?: {
    /** Present only when the literal enable subfield is statically `1`. */
    enabled?: true;
    targetWidth?: number;
    targetHeight?: number;
    rendering: 'partial-simulation';
  };
  runtimeScope: 'local-only';
  dynamicFields?: string[];
  invalidFields?: string[];
  warning?: string;
  warnings?: string[];
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
}

export interface DialogAddDlgCloseAction {
  dialogId?: number;
  sourceLabel: string;
  lineNumber: number;
  dynamic: boolean;
  /** LFM/GEE second DELDLG parameter; omission/0 means current user. */
  scope?: 'self' | 'all-users';
  scopeDynamic?: boolean;
  invalid?: boolean;
}

export type DialogAddDlgContentPreview =
  | {
    mode: 'inline';
    raw: string;
    status: 'static' | 'dynamic' | 'invalid';
  }
  | {
    mode: 'external-file';
    raw: string;
    absolute?: boolean;
    status: 'evidence-blocked' | 'dynamic' | 'invalid';
  };

export interface DialogAddDlgWindow {
  id: string;
  /** Engine-specific command grammar; omitted on legacy serialized previews. */
  command?: 'ADDDLG' | 'ADDDLGEX';
  dialogId?: number;
  raw: string;
  lineNumber: number;
  sourceRange: SourceSpan;
  sourceUri?: string;
  sourceFilePath?: string;
  sourceDocumentVersion?: number;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
  movable?: boolean;
  windowX?: number;
  windowY?: number;
  windowOriginBinding?: DialogCoordinateBinding;
  textOffsetX?: number;
  textOffsetY?: number;
  contentOriginBinding?: DialogCoordinateBinding;
  createPosition?: number;
  createPositionLabel?: string;
  qfTarget?: string;
  /** LFM/GEE inline or external-file content contract. Never used as a GOM QF target. */
  contentPreview?: DialogAddDlgContentPreview;
  /** Physical #ACT tail occupied by LFM ADDDLG inline content. */
  contentSourceRange?: SourceSpan;
  parentSyncMove?: boolean;
  refreshCoordinates?: boolean;
  groupId: number;
  displayMode: number;
  popupDirection: number;
  closeOnLeave: boolean;
  closeDelayMs: number;
  closeActions: DialogAddDlgCloseAction[];
  dynamicFields: string[];
  invalidFields: string[];
  warnings: string[];
}

export interface DialogScene {
  id: string;
  title: string;
  sourceLabel: string;
  marker: '#SAY' | '#ELSESAY' | 'STATIC';
  conditions: string[];
  conditionOperators: DialogConditionOperator[];
  conditionGroupId?: string;
  previewPath: Record<string, boolean>;
  conditionSummary: string;
  sourceStart: number;
  sourceEnd: number;
  background?: DialogBackground;
  addDlgWindow?: DialogAddDlgWindow;
  elements: DialogElement[];
  unsupportedStatements: string[];
  warnings: string[];
  resolvedVariables: DialogResolvedVariable[];
}

export interface DialogPagePreview {
  id: string;
  title: string;
  sourceLabel: string;
  conditionSummary: string;
  conditionGroupIds: string[];
  activeBranchIds: string[];
  background?: DialogBackground;
  addDlgWindow?: DialogAddDlgWindow;
  elements: DialogElement[];
  unsupportedStatements: string[];
  warnings: string[];
  resolvedVariables: DialogResolvedVariable[];
}

export interface NpcDialogOffsets {
  memoX: number;
  memoY: number;
  menuX: number;
  menuY: number;
  source: 'setup' | 'workspace' | 'default';
  configured: boolean;
  setupPath?: string;
}

export type DialogActUiCommand =
  | 'messagebox'
  | 'show-progress-bar'
  | 'play-window-effect'
  | 'send-move-hint'
  | 'open-upgrade-dialog'
  | 'open-client-dialog';

export type DialogActUiFieldStatus =
  | 'static'
  | 'dynamic'
  | 'invalid'
  | 'evidence-blocked';

export interface DialogActUiField {
  name: string;
  status: DialogActUiFieldStatus;
  raw?: string;
  value?: string | number | boolean | number[] | string[];
  /**
   * Safe, display-only text/quantity snapshot for the read-only #ACT card.
   * This never replaces `value` and must not unlock a client action, resource,
   * coordinate, timer, dialog id, or any other runtime state.
   */
  displayValueSource?: DialogDisplayValueSource;
}

export interface DialogActUiPreview {
  id: string;
  command: DialogActUiCommand;
  sourceLabel: string;
  lineNumber: number;
  sourceRange: SourceSpan;
  fields: DialogActUiField[];
  simulation: 'partial';
  localOnly: true;
  evidenceStatus?: 'evidence-blocked';
  dynamicFields?: string[];
  invalidFields?: string[];
  warning: string;
}

export interface NpcDialogDocumentModel {
  uri: string;
  fileName: string;
  filePath: string;
  documentVersion: number;
  engine: EngineId;
  engineLabel: string;
  functionLabel: string;
  functionStart: number;
  functionEnd: number;
  offsets: NpcDialogOffsets;
  /** Fixed game-client anchoring surface; independent from the scrollable editor extent. */
  clientWidth: number;
  clientHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  conditionGroups: DialogConditionGroup[];
  addDlgWindows: DialogAddDlgWindow[];
  companionUris: string[];
  companionFilePaths: string[];
  companionCandidateFilePaths: string[];
  scenes: DialogScene[];
  pages: DialogPagePreview[];
  actUiPreviews: DialogActUiPreview[];
  warnings: string[];
}

export interface DialogCoordinateChange {
  elementId: string;
  x: number;
  y: number;
}

export interface TextReplacement {
  start: number;
  end: number;
  text: string;
  elementId: string;
  axis: 'x' | 'y';
}
