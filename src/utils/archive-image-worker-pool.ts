import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { ReadArchiveImageOptions } from './archive-index';

interface QueueItem {
  id: number;
  options: ReadArchiveImageOptions;
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  current?: QueueItem;
}

export class ArchiveWorkerDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveWorkerDecodeError';
  }
}

export class ArchiveImageWorkerPool {
  private readonly queue: QueueItem[] = [];
  private readonly slots: WorkerSlot[] = [];
  private nextId = 1;
  private disposed = false;
  private startupError: Error | undefined;

  constructor(private readonly workerCount = recommendedWorkerCount()) {}

  read(options: ReadArchiveImageOptions): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('素材解码 Worker 已关闭'));
    if (this.startupError) return Promise.reject(this.startupError);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, options, resolve, reject });
      this.ensureWorkers();
      this.dispatch();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('素材解码 Worker 已关闭');
    for (const item of this.queue.splice(0)) item.reject(error);
    for (const slot of this.slots.splice(0)) {
      if (slot.current) slot.current.reject(error);
      void slot.worker.terminate();
    }
  }

  private ensureWorkers(): void {
    if (this.slots.length > 0 || this.startupError || this.disposed) return;
    const workerPath = path.join(__dirname, 'archive-image-worker.js');
    if (!fs.existsSync(workerPath)) {
      this.failStartup(new Error(`缺少素材解码 Worker: ${workerPath}`));
      return;
    }
    try {
      for (let index = 0; index < this.workerCount; index++) {
        const slot: WorkerSlot = { worker: new Worker(workerPath) };
        slot.worker.on('message', message => this.complete(slot, message));
        slot.worker.on('error', error => this.failSlot(slot, error));
        slot.worker.on('exit', code => {
          if (!this.disposed && code !== 0) {
            this.failSlot(slot, new Error(`素材解码 Worker 退出 (${code})`));
          }
        });
        this.slots.push(slot);
      }
    } catch (error) {
      this.failStartup(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private dispatch(): void {
    if (this.disposed || this.startupError) return;
    for (const slot of this.slots) {
      if (slot.current || this.queue.length === 0) continue;
      const item = this.queue.shift()!;
      slot.current = item;
      slot.worker.postMessage({ id: item.id, options: item.options });
    }
  }

  private complete(slot: WorkerSlot, message: { id?: number; data?: Uint8Array; error?: string }): void {
    const item = slot.current;
    if (!item || message.id !== item.id) return;
    slot.current = undefined;
    if (message.error) item.reject(new ArchiveWorkerDecodeError(message.error));
    else if (message.data) item.resolve(new Uint8Array(message.data));
    else item.reject(new Error('素材解码 Worker 返回了无效响应'));
    this.dispatch();
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    this.slots.splice(index, 1);
    if (slot.current) {
      slot.current.reject(error);
      slot.current = undefined;
    }
    void slot.worker.terminate();
    if (this.slots.length === 0) this.failStartup(error);
    else this.dispatch();
  }

  private failStartup(error: Error): void {
    if (this.startupError) return;
    this.startupError = error;
    for (const item of this.queue.splice(0)) item.reject(error);
    for (const slot of this.slots.splice(0)) {
      if (slot.current) slot.current.reject(error);
      void slot.worker.terminate();
    }
  }
}

function recommendedWorkerCount(): number {
  return os.totalmem() >= 12 * 1024 * 1024 * 1024 && os.cpus().length >= 6 ? 2 : 1;
}
