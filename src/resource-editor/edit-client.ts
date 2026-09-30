import * as path from 'path';
import { Worker } from 'worker_threads';
import type { ResourceEditorSlot } from './model';
import type { ResourceBatchRequest, ResourceClipboardFrame } from './batch';

export interface EditCapabilities {
  canReplace: boolean; canFill: boolean; canAppend: boolean;
  canClear: boolean; canOffsets: boolean; canSaveAs: boolean;
}
export interface EditInfo {
  profileId: string; slotCount: number; imageCount: number; dirty: boolean;
  revision: number; canUndo: boolean; canRedo: boolean; sourceSha256: string;
  sourcePath: string; capabilities: EditCapabilities;
  sourceCompanionSha256?: string;
  saveMode?: 'directory';
}
export interface EditSaveResult {
  sourceSha256Before: string; sourceSha256After: string; targetSha256: string;
  verification: unknown; session: EditInfo;
}
type EditMethod = 'open' | 'info' | 'listSlots' | 'preview' | 'importImage' | 'clear' | 'offsets' | 'undo' | 'redo' | 'saveAs' | 'prepareBatch' | 'applyBatch' | 'cancelBatch' | 'copy';
export class EditWorkerError extends Error {
  constructor(readonly code: string) { super('资源编辑操作未完成'); this.name = 'EditWorkerError'; }
}

/** A private worker per edit session; paths and credentials never go to the webview. */
export class ArchiveEditClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private closed = false;
  constructor() {
    this.worker = new Worker(path.join(__dirname, 'edit-worker.js'));
    this.worker.on('message', (reply: { id?: number; result?: unknown; errorCode?: string }) => {
      const item = this.pending.get(reply.id!);
      if (!item) return;
      this.pending.delete(reply.id!);
      if (reply.errorCode) item.reject(new EditWorkerError(reply.errorCode));
      else item.resolve(reply.result);
    });
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => this.fail());
  }
  private fail(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new EditWorkerError('WORKER_EXIT'));
    this.pending.clear();
  }
  private request<T>(method: EditMethod, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed || this.pending.size >= 8) return Promise.reject(new EditWorkerError('WORKER_UNAVAILABLE'));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try { this.worker.postMessage({ id, method, params }); }
      catch { this.pending.delete(id); reject(new EditWorkerError('WORKER_UNAVAILABLE')); }
    });
  }
  open(extensionPath: string, sourcePath: string, password: string): Promise<EditInfo> {
    return this.request('open', { extensionPath, sourcePath, password });
  }
  info(): Promise<EditInfo> { return this.request('info'); }
  prepareBatch(request: ResourceBatchRequest, revision: number, signal?: AbortSignal): Promise<{ rows: { index: number; action: string; name?: string }[]; revision: number }> {
    return this.batchRequest('prepareBatch', { request, revision }, signal);
  }
  applyBatch(revision: number, signal?: AbortSignal): Promise<EditInfo> { return this.batchRequest('applyBatch', { revision }, signal); }
  private async batchRequest<T>(method: 'prepareBatch' | 'applyBatch', params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const cancel = new SharedArrayBuffer(4), flag = new Int32Array(cancel);
    const abort = () => { Atomics.store(flag, 0, 1); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try { return await this.request<T>(method, { ...params, cancel }); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  cancelBatch(): Promise<boolean> { return this.request('cancelBatch'); }
  copy(ids: number[], revision: number): Promise<ResourceClipboardFrame[]> { return this.request('copy', { ids, revision }); }
  slots(start: number, limit: number): Promise<ResourceEditorSlot[]> { return this.request('listSlots', { start, limit }); }
  preview(index: number): Promise<Uint8Array> { return this.request('preview', { index }); }
  importImage(mode: 'replace' | 'fill' | 'append', index: number | null, imagePath: string, revision: number): Promise<EditInfo> {
    return this.request('importImage', { mode, index, imagePath, revision });
  }
  clear(index: number, revision: number): Promise<EditInfo> { return this.request('clear', { index, revision }); }
  offsets(index: number, x: number, y: number, revision: number): Promise<EditInfo> { return this.request('offsets', { index, x, y, revision }); }
  undo(revision: number): Promise<EditInfo> { return this.request('undo', { revision }); }
  redo(revision: number): Promise<EditInfo> { return this.request('redo', { revision }); }
  saveAs(targetPath: string, revision: number): Promise<EditSaveResult> { return this.request('saveAs', { targetPath, revision }); }
  async dispose(): Promise<void> {
    this.fail();
    await this.worker.terminate();
  }
}

// Existing isolated P2 probes use this name. Both route through the same profile-gated worker.
export { ArchiveEditClient as JpkEditClient };
