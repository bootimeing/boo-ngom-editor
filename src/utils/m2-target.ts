import * as fs from 'fs';
import * as path from 'path';

export function isM2ReloadScriptPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.txt' && extension !== '.ini') return false;
  return /[\/\\](?:Mir200[\/\\])?Envir[\/\\]/i.test(filePath);
}

export function findM2PathFromLocation(location: string): string | null {
  let current = path.resolve(location);
  try {
    if (fs.statSync(current).isFile()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  for (let depth = 0; depth <= 10; depth++) {
    const direct = path.join(current, 'M2Server.exe');
    if (path.basename(current).toLowerCase() === 'mir200' && fs.existsSync(direct)) {
      return direct;
    }
    const nested = path.join(current, 'Mir200', 'M2Server.exe');
    if (fs.existsSync(nested)) return nested;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function buildReloadPathCommand(targetPath: string, items: string[]): string {
  if (targetPath.includes('|')) return 'ERR:M2Server 路径不能包含竖线字符';
  return `reloadpath:${targetPath}|${items.join(',')}`;
}
