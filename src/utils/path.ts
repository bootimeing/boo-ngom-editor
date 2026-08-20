/**
 * 路径解析工具 — BOO脚本 Envir 目录结构
 */
import * as path from 'path';
import * as fs from 'fs';

/** MirServer 工作区中 BOO 脚本可能所在的基础目录 */
export const ENVIR_BASE_SUBDIRS = [
  'Mir200/Envir/QuestDiary',
  'Envir/QuestDiary',
  'Mir200/Envir/Market_Def',
  'Envir/Market_Def',
  'Mir200/Envir',
  'Envir',
];

/**
 * 生成工作区内所有可能的脚本搜索目录
 * 顺序: Mir200前缀优先 → 不含Mir200前缀 → 附加目录
 */
export function getScriptBaseDirs(wsRoot: string, ...extra: string[]): string[] {
  const dirs = ENVIR_BASE_SUBDIRS.map(d => path.join(wsRoot, ...d.split('/')));
  return dirs.concat(extra);
}

/**
 * 在 BOO 脚本目录中解析文件路径
 * 自动尝试 .txt 后缀, 返回存在的文件路径或 null
 */
export function resolveScriptFile(wsRoot: string, scriptPath: string, ...extraDirs: string[]): string | null {
  const bases = getScriptBaseDirs(wsRoot, ...extraDirs);
  for (const base of bases) {
    try {
      const fullPath = path.resolve(base, scriptPath);
      if (fs.existsSync(fullPath)) return fullPath;
      if (!scriptPath.endsWith('.txt') && fs.existsSync(fullPath + '.txt')) return fullPath + '.txt';
      const altPath = fullPath.replace(/\\/g, '/');
      if (fs.existsSync(altPath)) return altPath;
      if (!scriptPath.endsWith('.txt') && fs.existsSync(altPath + '.txt')) return altPath + '.txt';
    } catch (e) {
      console.warn('[BOO] 路径解析失败:', e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

export interface ScriptPathReference {
  path: string;
  start: number;
  end: number;
}

export interface ScriptPathResolution {
  candidates: string[];
  existingPath?: string;
  createPath?: string;
}

export type ScriptPathBase = 'auto' | 'questDiary' | 'defines';

export interface ScriptCommandPathReference extends ScriptPathReference {
  kind: 'scriptCall' | 'include';
  directive: '#CALL' | '#CALLEX' | '#INCLUDE';
  label?: string;
  matchStart: number;
  matchEnd: number;
}

const REFERENCED_TEXT_EXTENSIONS = new Set(['.txt', '.ini', '.csv']);

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function findScriptPathReferences(line: string): ScriptPathReference[] {
  const commentIndex = line.indexOf(';');
  const searchText = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const pattern = /(?:^|[\s=\[\(,])(\.{0,2}[\\/]?[\w\u4e00-\u9fff]+(?:[\\/][\w\u4e00-\u9fff]+)*\.(?:txt|ini|csv))/gi;
  const references: ScriptPathReference[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(searchText)) !== null) {
    const value = match[1];
    if (!/[\\/]/.test(value)) continue;
    const start = match.index + match[0].length - value.length;
    const end = start + value.length;
    references.push({ path: value, start, end });
  }
  return references;
}

export function findScriptPathReferenceAt(line: string, character: number): ScriptPathReference | undefined {
  return findScriptPathReferences(line)
    .find(reference => character >= reference.start && character <= reference.end);
}

function normalizeCapturedPath(value: string, absoluteStart: number): ScriptPathReference | undefined {
  let startOffset = value.search(/\S/);
  if (startOffset < 0) return undefined;
  let endOffset = value.length;
  while (endOffset > startOffset && /\s/.test(value[endOffset - 1])) endOffset--;
  const quote = value[startOffset];
  if ((quote === '"' || quote === "'") && value[endOffset - 1] === quote) {
    startOffset++;
    endOffset--;
  }
  if (endOffset <= startOffset) return undefined;
  return {
    path: value.slice(startOffset, endOffset),
    start: absoluteStart + startOffset,
    end: absoluteStart + endOffset,
  };
}

export function findScriptCommandPathReferences(line: string): ScriptCommandPathReference[] {
  const commentIndex = line.indexOf(';');
  const searchText = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const references: ScriptCommandPathReference[] = [];

  const callPattern = /#(CALL(?:EX)?)\s*\[([^\]]+)\]\s*(?:@([^\s;]+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(searchText)) !== null) {
    const capturedStart = match.index + match[0].indexOf(match[2]);
    const pathReference = normalizeCapturedPath(match[2], capturedStart);
    if (!pathReference) continue;
    references.push({
      ...pathReference,
      kind: 'scriptCall',
      directive: `#${match[1].toUpperCase()}` as '#CALL' | '#CALLEX',
      label: match[3]?.trim() || undefined,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    });
  }

  const includePattern = /#INCLUDE\b\s+(?:\[([^\]]+)\]|"([^"]+)"|'([^']+)'|([^\s;]+))/gi;
  while ((match = includePattern.exec(searchText)) !== null) {
    const captured = match[1] ?? match[2] ?? match[3] ?? match[4];
    const capturedStart = match.index + match[0].indexOf(captured);
    const pathReference = normalizeCapturedPath(captured, capturedStart);
    if (!pathReference) continue;
    references.push({
      ...pathReference,
      kind: 'include',
      directive: '#INCLUDE',
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    });
  }

  return references.sort((left, right) => left.start - right.start);
}

export function resolveScriptPathReference(
  wsRoot: string,
  sourceFile: string,
  reference: string,
  baseKind: ScriptPathBase = 'auto'
): ScriptPathResolution {
  let trimmed = reference.trim().replace(/^['"]|['"]$/g, '');
  if (baseKind !== 'auto') {
    if (/^[a-z]:/i.test(trimmed)) return { candidates: [] };
    trimmed = trimmed.replace(/^[\\/]+/, '').replace(/^\.[\\/]/, '');
    if (baseKind === 'questDiary') {
      trimmed = trimmed
        .replace(/^\.\.[\\/]QuestDiary[\\/]/i, '')
        .replace(/^QuestDiary[\\/]/i, '');
    } else {
      trimmed = trimmed
        .replace(/^\.\.[\\/]Defines[\\/]/i, '')
        .replace(/^Defines[\\/]/i, '');
    }
  } else if (path.isAbsolute(trimmed)) {
    return { candidates: [] };
  }

  if (!path.extname(trimmed)) {
    if (baseKind === 'questDiary') trimmed += '.txt';
    else if (baseKind === 'defines') trimmed += '.ini';
  }
  const extension = path.extname(trimmed).toLocaleLowerCase();
  if (!REFERENCED_TEXT_EXTENSIONS.has(extension)) return { candidates: [] };

  const fromEnvirRoot = baseKind === 'auto' && /^\.\.[\\/]/.test(trimmed);
  const relativePath = fromEnvirRoot ? trimmed.replace(/^\.\.[\\/]/, '') : trimmed.replace(/^\.[\\/]/, '');
  const hasTraversal = relativePath.split(/[\\/]/).some(segment => segment === '..');
  if (!relativePath || relativePath.includes(':') || (hasTraversal && baseKind !== 'questDiary')) {
    return { candidates: [] };
  }

  const bases = baseKind === 'questDiary'
    ? [path.join(wsRoot, 'Mir200', 'Envir', 'QuestDiary'), path.join(wsRoot, 'Envir', 'QuestDiary')]
    : baseKind === 'defines'
      ? [path.join(wsRoot, 'Mir200', 'Envir', 'Defines'), path.join(wsRoot, 'Envir', 'Defines')]
      : fromEnvirRoot
        ? [path.join(wsRoot, 'Mir200', 'Envir'), path.join(wsRoot, 'Envir')]
        : [path.dirname(sourceFile)];
  const usableBases = bases.filter(base => isPathInside(wsRoot, base));
  const candidates = usableBases
    .map(base => path.resolve(base, relativePath))
    .filter(candidate => baseKind === 'questDiary' || isPathInside(wsRoot, candidate));
  const existingPath = candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  const createBase = usableBases.find(base => {
    try { return fs.statSync(base).isDirectory(); } catch { return false; }
  }) || (baseKind !== 'auto'
    ? usableBases.find(base => {
        try { return fs.statSync(path.dirname(base)).isDirectory(); } catch { return false; }
      })
    : undefined);
  const createPath = createBase && !hasTraversal
    ? path.resolve(createBase, relativePath)
    : undefined;

  return {
    candidates,
    existingPath,
    createPath: createPath && isPathInside(wsRoot, createPath) ? createPath : undefined,
  };
}
