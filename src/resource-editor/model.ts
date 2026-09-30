import type { ArchiveExportSelection } from './export';

export const RESOURCE_EDITOR_PAGE_SIZE = 100;
export const RESOURCE_EDITOR_SELECTION_LIMIT = 10_000;

type Request = { sessionId: string; documentId: string; requestId: number };
export type ResourceEditorMessage =
  | { type: 'ready'; documentId: string }
  | (Request & { type: 'page'; start: number })
  | (Request & { type: 'jump' | 'inspect'; index: number })
  | (Request & { type: 'export'; selection: ArchiveExportSelection })
  | (Request & { type: 'cancelExport' | 'beginEdit' })
  | (Request & { type: 'animation' })
  | (Request & { type: 'reference' })
  | (Request & { type: 'exportAnimation'; fps: number; ids: number[]; revision: number })
  | (Request & { type: 'importImage'; revision: number; mode: 'replace' | 'fill' | 'append'; index: number | null })
  | (Request & { type: 'clearSlot'; revision: number; index: number })
  | (Request & { type: 'batchTools'; revision: number; ids: number[]; index: number | null })
  | (Request & { type: 'setOffsets'; revision: number; index: number; x: number; y: number })
  | (Request & { type: 'undo' | 'redo' | 'saveAs' | 'endEdit'; revision: number });

export interface ResourceEditorSlot {
  index: number;
  status: string;
  width?: number;
  height?: number;
  offsetX?: number | null;
  offsetY?: number | null;
  pixelFormat?: string;
  compression?: string;
  alpha?: string;
  imageUrl?: string;
  modified?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资源请求无效');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('资源请求字段无效');
  }
}

function index(value: unknown, slotCount: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= slotCount) {
    throw new Error('素材 ID 超出范围');
  }
  return value;
}

export function resourceEditorPageStart(value: number, slotCount: number): number {
  if (value === 0 && slotCount === 0) return 0;
  return Math.floor(index(value, slotCount) / RESOURCE_EDITOR_PAGE_SIZE) * RESOURCE_EDITOR_PAGE_SIZE;
}

export function parseResourceExportSelection(value: unknown, slotCount: number): ArchiveExportSelection {
  const selection = record(value);
  if (selection.kind === 'all') { keys(selection, ['kind']); return { kind: 'all' }; }
  if (selection.kind === 'range') {
    keys(selection, ['kind', 'start', 'end']);
    const start = index(selection.start, slotCount), end = index(selection.end, slotCount);
    if (end < start) throw new Error('导出结束 ID 不能小于起始 ID');
    return { kind: 'range', start, end };
  }
  if (selection.kind === 'ids') {
    keys(selection, ['kind', 'ids']);
    if (!Array.isArray(selection.ids) || !selection.ids.length || selection.ids.length > RESOURCE_EDITOR_SELECTION_LIMIT) {
      throw new Error('请选择 1–10000 个素材，更多素材请使用范围或全包导出');
    }
    const ids = selection.ids.map(id => index(id, slotCount));
    if (new Set(ids).size !== ids.length) throw new Error('导出 ID 重复');
    return { kind: 'ids', ids: ids.sort((a, b) => a - b) };
  }
  throw new Error('导出范围无效');
}

/** The webview can select IDs and operations, never local files or secrets. */
export function parseResourceEditorMessage(value: unknown, sessionId: string, documentId: string, slotCount: number): ResourceEditorMessage {
  const message = record(value);
  if (typeof message.documentId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(message.documentId)) {
    throw new Error('页面身份无效');
  }
  if (message.type === 'ready') {
    keys(message, ['type', 'documentId']);
    return { type: 'ready', documentId: message.documentId };
  }
  if (message.sessionId !== sessionId || message.documentId !== documentId) throw new Error('资源会话已失效');
  if (typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId) || message.requestId < 1) {
    throw new Error('资源请求序号无效');
  }
  const base = { sessionId, documentId, requestId: message.requestId };
  const common = ['type', 'sessionId', 'documentId', 'requestId'];
  const revision = () => {
    if (typeof message.revision !== 'number' || !Number.isSafeInteger(message.revision) || message.revision < 0) throw new Error('编辑版本无效');
    return message.revision;
  };
  switch (message.type) {
    case 'page':
      keys(message, [...common, 'start']);
      return { ...base, type: 'page', start: resourceEditorPageStart(message.start as number, slotCount) };
    case 'jump':
    case 'inspect':
      keys(message, [...common, 'index']);
      return { ...base, type: message.type, index: index(message.index, slotCount) };
    case 'export':
      keys(message, [...common, 'selection']);
      return { ...base, type: 'export', selection: parseResourceExportSelection(message.selection, slotCount) };
    case 'cancelExport':
    case 'beginEdit':
    case 'animation':
    case 'reference':
      keys(message, common);
      return { ...base, type: message.type };
    case 'exportAnimation': {
      keys(message, [...common, 'fps', 'ids', 'revision']);
      if (!Number.isInteger(message.fps) || Number(message.fps) < 1 || Number(message.fps) > 60) throw new Error('帧率无效');
      const selection = parseResourceExportSelection({ kind: 'ids', ids: message.ids }, slotCount) as { ids: number[] };
      if (selection.ids.length > 256) throw new Error('最多 256 帧');
      return { ...base, type: 'exportAnimation', ids: [...message.ids as number[]], fps: message.fps as number, revision: revision() };
    }
    case 'importImage': {
      keys(message, [...common, 'revision', 'mode', 'index']);
      if (message.mode !== 'replace' && message.mode !== 'fill' && message.mode !== 'append') throw new Error('导入模式无效');
      if (message.mode === 'append' && message.index !== null) throw new Error('追加不接受现有槽位');
      return { ...base, type: 'importImage', revision: revision(), mode: message.mode,
        index: message.mode === 'append' ? null : index(message.index, slotCount) };
    }
    case 'clearSlot':
      keys(message, [...common, 'revision', 'index']);
      return { ...base, type: 'clearSlot', revision: revision(), index: index(message.index, slotCount) };
    case 'batchTools': {
      keys(message, [...common, 'revision', 'ids', 'index']);
      const selection = Array.isArray(message.ids) && !message.ids.length ? [] : (parseResourceExportSelection({ kind: 'ids', ids: message.ids }, slotCount) as { ids: number[] }).ids;
      return { ...base, type: 'batchTools', revision: revision(), ids: selection, index: message.index === null ? null : index(message.index, slotCount) };
    }
    case 'setOffsets':
      keys(message, [...common, 'revision', 'index', 'x', 'y']);
      for (const coordinate of [message.x, message.y]) {
        if (typeof coordinate !== 'number' || !Number.isInteger(coordinate) || coordinate < -32768 || coordinate > 32767) throw new Error('偏移须在 -32768 到 32767 之间');
      }
      return { ...base, type: 'setOffsets', revision: revision(), index: index(message.index, slotCount), x: message.x as number, y: message.y as number };
    case 'undo': case 'redo': case 'saveAs': case 'endEdit':
      keys(message, [...common, 'revision']);
      return { ...base, type: message.type, revision: revision() };
    default: throw new Error('资源操作无效');
  }
}
