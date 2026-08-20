/**
 * PAK素材列表工具 — 读取 EffectImageList.txt 建立 will序号→PAK名字 映射
 */
import * as fs from 'fs';
import * as path from 'path';
import { readFileGBK } from './text';
import { resolveEngineRoot } from './engine-detect';
import { ArchiveExtension } from './archive-types';

export interface PakIndexEntry {
  name: string;
  willIdx: number;
  extension?: ArchiveExtension;
}

/** 简单 LRU 缓存，容量上限可配置 */
class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // 移到末尾（最近使用）
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      // 删除最旧的
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  clear() { this.map.clear(); }
}

// 文件级缓存实例
const pakIndexCache = new LRUCache<string, {
  pakMap: Map<number, string>;
  pakList: PakIndexEntry[];
}>(256);

/**
 * 从 Mir200\Envir\EffectImageList.txt 读取PAK列表
 * 返回: PAK名字(不含.Pak后缀) → will序号 的映射, 以及按序号排序的PAK名字列表
 */
export function loadPakIndex(wsRoot: string): {
  pakMap: Map<number, string>;
  pakList: PakIndexEntry[];
} | null {
  const cacheKey = wsRoot.toLowerCase();
  const cached = pakIndexCache.get(cacheKey);
  if (cached) return cached;

  const roots = [...new Map(
    [wsRoot, resolveEngineRoot(wsRoot)]
      .filter(Boolean)
      .map(root => {
        const resolved = path.resolve(root);
        return [resolved.toLowerCase(), resolved];
      })
  ).values()];
  const candidates = roots.flatMap(root => [
    path.join(root, 'Mir200', 'Envir', 'EffectImageList.txt'),
    path.join(root, 'Envir', 'EffectImageList.txt'),
  ]);
  let filePath = '';
  for (const c of candidates) { if (fs.existsSync(c)) { filePath = c; break; } }
  if (!filePath) return null;

  try {
    const raw = fs.readFileSync(filePath);
    const text = readFileGBK(raw);
    const lines = text.split(/\r?\n/);
    const pakMap = new Map<number, string>();
    const pakList: PakIndexEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const configuredName = lines[i].trim().replace(/[\\/]+/g, path.sep);
      const rawExtension = path.extname(configuredName).slice(1).toLowerCase();
      const extension = /^(?:pak|jpk|wil|wzl)$/.test(rawExtension)
        ? rawExtension as ArchiveExtension
        : undefined;
      const name = path.basename(configuredName).replace(/\.(?:pak|jpk|wil|wzl)$/i, '');
      if (name) {
        pakMap.set(i, name);
        pakList.push({ name, willIdx: i, extension });
      }
    }
    const result = { pakMap, pakList };
    pakIndexCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[BOO] PAK索引文件读取失败:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** 仅允许读取 EffectImageList.txt 中存在的 PAK 文件。 */
export function matchPakFile(
  pakPath: string,
  pakList: PakIndexEntry[]
): PakIndexEntry | undefined {
  const pakName = path.basename(pakPath, path.extname(pakPath));
  const extension = path.extname(pakPath).slice(1).toLowerCase();
  return pakList.find(item =>
    item.name.toLowerCase() === pakName.toLowerCase()
    && (!item.extension || item.extension === extension)
  );
}

/** 清除所有 PAK 相关缓存（供外部在文件变更时调用） */
export function clearPakCache() {
  pakIndexCache.clear();
}
