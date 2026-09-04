import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  originalMapTilePath,
  parseOriginalMapTileChunkId,
  readOriginalMapTile,
  readOriginalMapTileManifest,
} from './original-map-tile-cache';

export const ORIGINAL_MAP_TILE_RESOURCE_SCHEME = 'boo-map-tile';
export const ORIGINAL_MAP_TILE_RESOURCE_ROOT = vscode.Uri.parse(
  `${ORIGINAL_MAP_TILE_RESOURCE_SCHEME}:/`
);

const CACHE_KEY = /^[a-f0-9]{64}$/;
const RESOURCE_PATH = /^\/([a-f0-9]{64})\/(c(?:0|[1-9]\d*)-r(?:0|[1-9]\d*))\.png$/;

interface OriginalMapTileResourceTarget {
  cacheKey: string;
  chunkId: string;
}

interface ResolvedOriginalMapTileResource extends OriginalMapTileResourceTarget {
  data: Buffer;
  filePath: string;
}

export class OriginalMapTileResourceProvider
implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly cacheRoot: string;

  readonly onDidChangeFile = this.changedEmitter.event;

  constructor(cacheRoot: string) {
    this.cacheRoot = path.resolve(cacheRoot);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const resolved = this.resolveResource(uri);
    try {
      const fileStat = fs.statSync(resolved.filePath);
      return {
        type: vscode.FileType.File,
        ctime: fileStat.ctimeMs,
        mtime: fileStat.mtimeMs,
        size: resolved.data.byteLength,
      };
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('原始地图切片为只读');
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.resolveResource(uri).data;
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('原始地图切片为只读');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('原始地图切片为只读');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('原始地图切片为只读');
  }

  dispose(): void {
    this.changedEmitter.dispose();
  }

  private resolveResource(uri: vscode.Uri): ResolvedOriginalMapTileResource {
    const target = parseOriginalMapTileResourceUri(uri);
    try {
      // The manifest is authoritative for edge-chunk dimensions. Never infer
      // them from the URI or trust the PNG header without the generation identity.
      const manifest = readOriginalMapTileManifest(this.cacheRoot, target.cacheKey);
      if (!manifest) throw new Error('静态地图切片 manifest 不存在或无效');
      const data = readOriginalMapTile({
        cacheRoot: this.cacheRoot,
        cacheKey: target.cacheKey,
        chunkId: target.chunkId,
        mapWidth: manifest.mapWidth,
        mapHeight: manifest.mapHeight,
      });
      if (!data) throw new Error('静态地图切片不存在或 PNG 校验失败');
      return {
        ...target,
        data,
        filePath: originalMapTilePath(this.cacheRoot, target.cacheKey, target.chunkId),
      };
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }
}

export function originalMapTileResourceUri(
  cacheKey: string,
  chunkId: string
): vscode.Uri {
  if (!CACHE_KEY.test(cacheKey)) throw new Error('静态地图切片 cacheKey 无效');
  parseOriginalMapTileChunkId(chunkId);
  return vscode.Uri.from({
    scheme: ORIGINAL_MAP_TILE_RESOURCE_SCHEME,
    path: `/${cacheKey}/${chunkId}.png`,
  });
}

function parseOriginalMapTileResourceUri(uri: vscode.Uri): OriginalMapTileResourceTarget {
  if (
    uri.scheme !== ORIGINAL_MAP_TILE_RESOURCE_SCHEME
    || Boolean(uri.authority)
    || Boolean(uri.query)
    || Boolean(uri.fragment)
  ) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  const match = RESOURCE_PATH.exec(uri.path);
  if (!match) throw vscode.FileSystemError.FileNotFound(uri);
  const cacheKey = match[1];
  const chunkId = match[2];
  try {
    parseOriginalMapTileChunkId(chunkId);
  } catch {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  return { cacheKey, chunkId };
}
