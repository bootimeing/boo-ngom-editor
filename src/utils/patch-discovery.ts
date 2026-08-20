import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { resolveEngineRoot } from './engine-detect';
import { findNearbyPakPasswordFile } from './patch-cache';
import { discoverClientResourceLayout } from './client-resources';

export function findWorkspacePatchPasswordFile(
  engine: EngineId,
  dataDirectory: string,
  workspaceRoots: readonly string[]
): string | undefined {
  if (dataDirectory) {
    const layout = discoverClientResourceLayout(dataDirectory);
    const nearbyRoots = [
      ...layout.dataRoots,
      layout.clientDirectory,
      dataDirectory,
    ];
    for (const root of uniquePaths(nearbyRoots)) {
      const nearby = findNearbyPakPasswordFile(root);
      if (nearby) return nearby;
    }
  }
  if (engine !== '996PC') return undefined;

  const candidates: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const engineRoot = resolveEngineRoot(workspaceRoot);
    for (const root of [engineRoot, path.resolve(workspaceRoot)]) {
      candidates.push(
        path.join(root, '登录器生成器', 'JpkList.txt'),
        path.join(root, 'Mirserver', '登录器生成器', 'JpkList.txt')
      );
    }
  }
  return uniquePaths(candidates).find(isFile);
}

function uniquePaths(paths: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    const key = path.normalize(resolved).toLowerCase();
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()];
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}
