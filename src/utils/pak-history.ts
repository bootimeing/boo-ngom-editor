import * as path from 'path';
import * as fs from 'fs';

export interface PakHistoryEntry {
  path: string;
  lastOpenedAt: number;
}

export function mergePakHistory(
  existing: PakHistoryEntry[],
  openedPaths: string[],
  openedAt = Date.now(),
  limit = 30
): PakHistoryEntry[] {
  const result: PakHistoryEntry[] = [];
  const seen = new Set<string>();
  const append = (entry: PakHistoryEntry) => {
    const resolvedPath = path.resolve(entry.path);
    const key = normalizePakHistoryPath(resolvedPath);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ path: resolvedPath, lastOpenedAt: Number(entry.lastOpenedAt) || 0 });
  };

  for (const filePath of openedPaths) append({ path: filePath, lastOpenedAt: openedAt });
  for (const entry of [...existing].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)) append(entry);
  return result.slice(0, Math.max(1, limit));
}

export function prunePakHistory(
  entries: PakHistoryEntry[],
  exists: (filePath: string) => boolean
): PakHistoryEntry[] {
  return entries.filter(entry => {
    try { return exists(entry.path); } catch { return false; }
  });
}

export function normalizePakHistoryPath(filePath: string): string {
  return path.normalize(filePath).toLocaleLowerCase();
}

export function discoverPakHistoryFromCache(
  cacheRoot: string,
  limit = 30
): PakHistoryEntry[] {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return [];
  const discovered: PakHistoryEntry[] = [];
  try {
    for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(cacheRoot, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { pakPath?: unknown };
        if (
          typeof manifest.pakPath !== 'string'
          || !/\.(?:pak|jpk|wil|wzl)$/i.test(manifest.pakPath)
        ) continue;
        const pakPath = path.resolve(manifest.pakPath);
        if (!fs.existsSync(pakPath)) continue;
        discovered.push({
          path: pakPath,
          lastOpenedAt: fs.statSync(manifestPath).mtimeMs,
        });
      } catch {
        // Ignore incomplete or obsolete cache entries.
      }
    }
  } catch {
    return [];
  }

  const result: PakHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of discovered.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)) {
    const key = normalizePakHistoryPath(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.slice(0, Math.max(1, limit));
}
