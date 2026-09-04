import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { ArchiveExtension } from './archive-types';
import { getEngineDefinition } from './engine-registry';
import { decodeTextFile } from './text';

const READ_ONLY_PAIR_EXTENSIONS: readonly ArchiveExtension[] = ['wil', 'wzl'];

export function uiEditorArchiveExtensions(engine: EngineId): ArchiveExtension[] {
  return [...new Set<ArchiveExtension>([
    ...getEngineDefinition(engine).archiveExtensions,
    ...READ_ONLY_PAIR_EXTENSIONS,
  ])];
}

export function uiEditorArchiveLabel(engine: EngineId): string {
  return uiEditorArchiveExtensions(engine)
    .map(extension => extension.toUpperCase())
    .join('/');
}

export function gameUiPackArchiveNameFromConfig(text: string): string | undefined {
  const match = /^\s*GameUIPack\s*=\s*(.+?)\s*$/im.exec(text);
  if (!match) return undefined;
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  return value ? path.basename(value) : undefined;
}

export function configuredGameUiPackArchive(workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(workspaceRoot, '登录器生成器', 'Config.ini'),
    path.join(workspaceRoot, 'MirServer', '登录器生成器', 'Config.ini'),
    path.join(path.dirname(workspaceRoot), '登录器生成器', 'Config.ini'),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      const archiveName = gameUiPackArchiveNameFromConfig(
        decodeTextFile(fs.readFileSync(candidate)).text
      );
      if (archiveName) return archiveName;
    } catch {
      // Continue through the deterministic launcher-config candidates.
    }
  }
  return undefined;
}
