import * as path from 'path';
import { ImportedResourceImage, decodeResourcePng, readResourceImage, validateResourceImage } from './image-codec';
import { ImageTransform, transformResourceImage } from './image-transform';
import type { EditInfo } from './edit-client';
import type { ResourceEditorSlot } from './model';

const MAX_IMAGES = 256, MAX_BYTES = 64 * 1024 * 1024;
export interface ResourceClipboardFrame { image: ImportedResourceImage; x: number; y: number }
export type ResourceBatchRequest =
  | { kind: 'import'; paths: string[]; mapping: 'filename' | 'sequential' | 'append'; start: number }
  | { kind: 'offsets'; ids: number[]; x: number; y: number; relative: boolean }
  | { kind: 'clear'; ids: number[] }
  | { kind: 'transform'; ids: number[]; transform: ImageTransform }
  | { kind: 'paste'; frames: ResourceClipboardFrame[]; start: number; append: boolean };
interface ImportAction { kind: 'image'; index: number; mode: 'replace' | 'fill' | 'append'; image: ImportedResourceImage; x?: number; y?: number }
type Action = ImportAction | Extract<ResourceBatchRequest, { kind: 'offsets' | 'clear' }>;
export interface ResourceBatchPlan { actions: Action[]; rows: { index: number; action: string; name?: string }[]; revision: number }
export interface BatchSession {
  info(): EditInfo; listSlots(start: number, limit: number): ResourceEditorSlot[];
  previewPng(index: number): Buffer;
  importImage(options: { mode: 'replace' | 'fill' | 'append'; index?: number; image: ImportedResourceImage; x?: number; y?: number }): unknown;
  offsets(ids: number[], x: number, y: number, relative?: boolean): unknown;
  clear(ids: number[]): unknown;
  atomic(action: () => void, dryRun?: boolean): EditInfo;
}
function ids(value: number[], count: number, limit = 10000) {
  if (!Array.isArray(value) || !value.length || value.length > limit || new Set(value).size !== value.length
    || value.some(id => !Number.isInteger(id) || id < 0 || id >= count)) throw new Error('SELECTION_LIMIT');
  return [...value].sort((a, b) => a - b);
}
function budget(bytes: number) { if (bytes > MAX_BYTES) throw new Error('BATCH_MEMORY_LIMIT'); }
export function copyResourceFrames(session: BatchSession, selection: number[]): ResourceClipboardFrame[] {
  let bytes = 0;
  return ids(selection, session.info().slotCount, MAX_IMAGES).map(id => {
    const slot = session.listSlots(id, 1)[0];
    if (slot.status === 'empty') throw new Error('EMPTY_SLOT');
    budget(bytes + slot.width! * slot.height! * 4);
    const image = decodeResourcePng(session.previewPng(id)); bytes += image.rgba.byteLength;
    return { image, x: slot.offsetX!, y: slot.offsetY! };
  });
}
export function prepareResourceBatch(session: BatchSession, request: ResourceBatchRequest, check = () => {}): ResourceBatchPlan {
  check();
  const info = session.info(), plan: ResourceBatchPlan = { actions: [], rows: [], revision: info.revision };
  let count = info.slotCount, bytes = 0;
  const addImage = (index: number, image: ImportedResourceImage, name?: string, x?: number, y?: number) => {
    check();
    validateResourceImage(image); bytes += image.rgba.byteLength; budget(bytes);
    if (!Number.isInteger(index) || index < 0 || index > count) throw new Error('INVALID_INDEX');
    const mode = index === count ? 'append' : session.listSlots(index, 1)[0].status === 'empty' ? 'fill' : 'replace';
    if (mode === 'append') count++;
    plan.actions.push({ kind: 'image', index, mode, image, x, y }); plan.rows.push({ index, action: mode, name });
  };
  if (request.kind === 'import') {
    if (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > MAX_IMAGES
      || !['filename', 'sequential', 'append'].includes(request.mapping)) throw new Error('BATCH_LIMIT');
    const items = request.paths.map((file, ordinal) => {
      if (typeof file !== 'string') throw new Error('INVALID_PARAMS');
      const name = path.basename(file), match = /^(?:Image[_-])?(\d+)$/i.exec(path.basename(file, path.extname(file)));
      if (request.mapping === 'filename' && !match) throw new Error('FILENAME_ID_REQUIRED');
      const index = request.mapping === 'filename' ? Number(match![1]) : request.mapping === 'append' ? count + ordinal : request.start + ordinal;
      return { file, index, name };
    }).sort((a, b) => a.index - b.index);
    if (new Set(items.map(item => item.index)).size !== items.length) throw new Error('DUPLICATE_ID');
    for (const item of items) { check(); addImage(item.index, readResourceImage(item.file), item.name); }
  } else if (request.kind === 'paste') {
    if (!Array.isArray(request.frames) || !request.frames.length || request.frames.length > MAX_IMAGES) throw new Error('BATCH_LIMIT');
    for (let i = 0; i < request.frames.length; i++) {
      const frame = request.frames[i];
      addImage(request.append ? count : request.start + i, frame.image, undefined, frame.x, frame.y);
    }
  } else {
    const selection = ids(request.ids, count, request.kind === 'transform' ? MAX_IMAGES : 10000);
    if (request.kind === 'transform') {
      for (const id of selection) {
        check();
        const slot = session.listSlots(id, 1)[0];
        if (slot.status === 'empty') throw new Error('EMPTY_SLOT');
        budget(bytes + slot.width! * slot.height! * 4);
        const result = transformResourceImage(decodeResourcePng(session.previewPng(id)), request.transform);
        addImage(id, result.image, undefined, slot.offsetX! + result.dx, slot.offsetY! + result.dy);
      }
    } else if (request.kind === 'offsets' || request.kind === 'clear') {
      plan.actions.push({ ...request, ids: selection });
      for (const index of selection) plan.rows.push({ index, action: request.kind });
    } else throw new Error('INVALID_OPERATION');
  }
  // Run actual encoders/coordinate validation without committing any draft or history.
  applyResourceBatch(session, plan, true, check);
  return plan;
}
export function applyResourceBatch(session: BatchSession, plan: ResourceBatchPlan, dryRun = false, check = () => {}) {
  if (session.info().revision !== plan.revision) throw new Error('STALE_REVISION');
  return session.atomic(() => {
    for (const action of plan.actions) {
      check();
      if (action.kind === 'image') session.importImage({ mode: action.mode, index: action.index, image: action.image, x: action.x, y: action.y });
      else if (action.kind === 'clear') session.clear(action.ids);
      else session.offsets(action.ids, action.x, action.y, action.relative);
    }
    check();
  }, dryRun);
}
