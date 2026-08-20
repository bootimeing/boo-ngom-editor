import * as vscode from 'vscode';
import * as os from 'os';
import { DecodedPakAsset } from './pak-reader';
import {
  loadArchiveSummary,
  readArchiveImagePng,
} from './archive-index';
import {
  ArchiveImageWorkerPool,
  ArchiveWorkerDecodeError,
} from './archive-image-worker-pool';

export const ARCHIVE_RESOURCE_SCHEME = 'boo-archive';
export const ARCHIVE_RESOURCE_ROOT = vscode.Uri.parse(`${ARCHIVE_RESOURCE_SCHEME}:/`);

const MAX_IMAGE_CACHE_BYTES = os.totalmem() >= 12 * 1024 * 1024 * 1024
  ? 128 * 1024 * 1024
  : 64 * 1024 * 1024;

interface CachedImage {
  data: Uint8Array;
  lastUsed: number;
}

export class ArchiveResourceProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly imageCache = new Map<string, CachedImage>();
  private readonly pendingReads = new Map<string, Promise<Uint8Array>>();
  private readonly workerPool = new ArchiveImageWorkerPool();
  private cachedBytes = 0;

  readonly onDidChangeFile = this.changedEmitter.event;

  constructor(
    private readonly extensionPath: string,
    private readonly indexRoot: string
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const directory = parseArchiveDirectoryUri(uri);
    if (directory !== undefined) {
      if (directory) loadArchiveSummary(this.indexRoot, directory);
      const now = Date.now();
      return {
        type: vscode.FileType.Directory,
        ctime: now,
        mtime: now,
        size: 0,
      };
    }
    const target = parseArchiveResourceUri(uri);
    const summary = loadArchiveSummary(this.indexRoot, target.archiveId);
    if (target.imageIndex >= summary.slotCount) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: summary.createdAt,
      mtime: summary.sourceMtimeMs,
      size: 0,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('素材资源为只读');
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const target = parseArchiveResourceUri(uri);
    const key = `${target.archiveId}/${target.imageIndex}`;
    const cached = this.imageCache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      this.imageCache.delete(key);
      this.imageCache.set(key, cached);
      return cached.data;
    }

    const pending = this.pendingReads.get(key);
    if (pending) return pending;

    const options = {
      extensionPath: this.extensionPath,
      indexRoot: this.indexRoot,
      archiveId: target.archiveId,
      imageIndex: target.imageIndex,
    };
    const read = this.workerPool.read(options).catch(error => {
      if (error instanceof ArchiveWorkerDecodeError) throw error;
      console.warn('[BOO] 素材解码 Worker 不可用，改用兼容的单张解码:', error.message);
      return readArchiveImagePng(options);
    }).then(data => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.remember(key, bytes);
      return bytes;
    }).finally(() => {
      this.pendingReads.delete(key);
    });
    this.pendingReads.set(key, read);
    return read;
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('素材资源为只读');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('素材资源为只读');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('素材资源为只读');
  }

  dispose(): void {
    this.pendingReads.clear();
    this.workerPool.dispose();
    this.imageCache.clear();
    this.cachedBytes = 0;
    this.changedEmitter.dispose();
  }

  private remember(key: string, data: Uint8Array): void {
    const existing = this.imageCache.get(key);
    if (existing) this.cachedBytes -= existing.data.byteLength;
    this.imageCache.delete(key);
    this.imageCache.set(key, { data, lastUsed: Date.now() });
    this.cachedBytes += data.byteLength;
    while (this.cachedBytes > MAX_IMAGE_CACHE_BYTES && this.imageCache.size > 1) {
      const oldestKey = this.imageCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.imageCache.get(oldestKey);
      if (oldest) this.cachedBytes -= oldest.data.byteLength;
      this.imageCache.delete(oldestKey);
    }
  }
}

export function archiveResourceUri(archiveId: string, imageIndex: number): vscode.Uri {
  if (!/^[a-f0-9]{64}$/.test(archiveId)) throw new Error('素材索引标识无效');
  if (!Number.isInteger(imageIndex) || imageIndex < 0) throw new Error('素材序号无效');
  return vscode.Uri.from({
    scheme: ARCHIVE_RESOURCE_SCHEME,
    path: `/${archiveId}/${String(imageIndex).padStart(6, '0')}.png`,
  });
}

export function archiveAssetUri(asset: DecodedPakAsset): vscode.Uri | undefined {
  return asset.archiveId ? archiveResourceUri(asset.archiveId, asset.imageIdx) : undefined;
}

export function cachedPatchImageUri(image: {
  imagePath: string;
  archiveId?: string;
  imageIndex: number;
}): vscode.Uri {
  return image.archiveId
    ? archiveResourceUri(image.archiveId, image.imageIndex)
    : vscode.Uri.file(image.imagePath);
}

export function webviewResourceRoots(fileRoots: Iterable<string>): vscode.Uri[] {
  const roots = [...fileRoots].map(root => vscode.Uri.file(root));
  roots.push(ARCHIVE_RESOURCE_ROOT);
  return roots;
}

function parseArchiveDirectoryUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== ARCHIVE_RESOURCE_SCHEME) return undefined;
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1 && /^[a-f0-9]{64}$/.test(parts[0])) return parts[0];
  return undefined;
}

function parseArchiveResourceUri(uri: vscode.Uri): { archiveId: string; imageIndex: number } {
  if (uri.scheme !== ARCHIVE_RESOURCE_SCHEME) throw vscode.FileSystemError.FileNotFound(uri);
  const parts = uri.path.split('/').filter(Boolean);
  const archiveId = parts[0] || '';
  const imageText = (parts[1] || '').replace(/\.png$/i, '');
  const imageIndex = /^\d+$/.test(imageText) ? Number(imageText) : Number.NaN;
  if (!/^[a-f0-9]{64}$/.test(archiveId) || !Number.isInteger(imageIndex) || imageIndex < 0) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  return { archiveId, imageIndex };
}
