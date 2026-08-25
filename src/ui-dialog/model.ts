import { EngineId } from '../types';

export interface SourceSpan {
  start: number;
  end: number;
  original: string;
}

export type DialogCoordinateMode = 'absolute' | 'relative' | 'flow' | 'none';

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
  sourceLabel?: string;
  sourceLine?: number;
}

export type DialogElementKind =
  | 'text'
  | 'image'
  | 'button'
  | 'animation'
  | 'input'
  | 'progress'
  | 'item'
  | 'container'
  | 'monster'
  | 'generic'
  | 'unknown';

export interface DialogAssetReference {
  willIndex?: number;
  archiveName?: string;
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
  | 'scrollbar'
  | 'hover'
  | 'pressed';

export interface DialogAssetLayer {
  role: DialogAssetLayerRole;
  assetRef: DialogAssetReference;
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
  frameValue?: number;
  label: string;
  message?: string;
}

export interface DialogProgressPreview {
  minimum: number;
  maximum: number;
  value: number;
  ratio: number;
  direction: number;
  offsetX: number;
  offsetY: number;
  text: string;
}

export interface DialogAnimationPreview {
  frameCount: number;
  intervalMs: number;
  repeatCount?: number;
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

export interface DialogContainerPreview {
  variant: 'layout' | 'list' | 'line-break' | 'item-grid';
  label: string;
  borderColor?: string;
  cellCount?: number;
  columns?: number;
  rows?: number;
}

export interface DialogCoordinate {
  sourceValue: number;
  displayValue: number;
  span: SourceSpan;
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
  animationPreview?: DialogAnimationPreview;
  animationFrames?: DialogAssetPreview[];
  tooltipPreview?: DialogTooltipPreview;
  itemPreview?: DialogItemPreview;
  progressPreview?: DialogProgressPreview;
  containerPreview?: DialogContainerPreview;
  containerElementId?: string;
  containerParentId?: string;
  containerChildIds?: string[];
  parentElementId?: string;
  warning?: string;
}

export interface DialogBackground {
  raw: string;
  lineNumber: number;
  willIndex?: number;
  imageIndex?: number;
  assetRef?: DialogAssetReference;
  asset?: DialogAssetPreview;
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
  canvasWidth: number;
  canvasHeight: number;
  conditionGroups: DialogConditionGroup[];
  scenes: DialogScene[];
  pages: DialogPagePreview[];
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
