import * as path from 'path';

export interface QuickFileDefinition {
  fileName: string;
  description: string;
  envirRelativePath?: string;
  mir200RelativePath?: string;
  custom?: boolean;
}

export const CUSTOM_QUICK_FILES_STATE_KEY = 'boo.quickFiles.customMir200Paths';

export const QUICK_FILE_DEFINITIONS: readonly QuickFileDefinition[] = [
  {
    fileName: 'QManage.txt',
    description: '登录与全局管理触发脚本',
    envirRelativePath: path.join('MapQuest_Def', 'QManage.txt'),
  },
  {
    fileName: 'QFunction-0.txt',
    description: '物品、按钮与系统事件触发脚本',
    envirRelativePath: path.join('Market_Def', 'QFunction-0.txt'),
  },
  {
    fileName: 'MerChant.txt',
    description: 'NPC 脚本、地图坐标、名称与外观配置',
    envirRelativePath: 'MerChant.txt',
  },
  {
    fileName: 'MapInfo.txt',
    description: '地图编号、名称、门点与地图参数配置',
    envirRelativePath: 'MapInfo.txt',
  },
  {
    fileName: 'MonGen.txt',
    description: '地图怪物刷新位置、数量与间隔配置',
    envirRelativePath: 'MonGen.txt',
  },
  {
    fileName: 'MapEvent.txt',
    description: '地图坐标事件与对应脚本触发配置',
    envirRelativePath: 'MapEvent.txt',
  },
  {
    fileName: 'AutoRunRobot.txt',
    description: '机器人定时任务的运行时间与触发标签',
    envirRelativePath: path.join('Robot_def', 'AutoRunRobot.txt'),
  },
  {
    fileName: 'RobotManage.txt',
    description: '机器人定时任务实际执行的脚本',
    envirRelativePath: path.join('Robot_def', 'RobotManage.txt'),
  },
];

export function buildQuickFileCandidates(
  workspaceRoot: string,
  engineRoot: string,
  activeDocumentPath: string | undefined,
  definition: QuickFileDefinition
): string[] {
  if (definition.mir200RelativePath) {
    const relativePath = platformRelativePath(definition.mir200RelativePath);
    const mir200Roots: string[] = [];
    const activeMir200 = activeDocumentPath
      ? findNamedAncestor(path.dirname(activeDocumentPath), 'mir200')
      : '';
    if (activeMir200) mir200Roots.push(activeMir200);

    for (const root of [engineRoot, workspaceRoot]) {
      if (!root) continue;
      const ancestor = findNamedAncestor(root, 'mir200');
      if (ancestor) mir200Roots.push(ancestor);
      const baseName = path.basename(root).toLowerCase();
      if (baseName === 'mir200') mir200Roots.push(root);
      if (baseName === 'envir') mir200Roots.push(path.dirname(root));
      mir200Roots.push(
        path.join(root, 'Mir200'),
        path.join(root, 'Mirserver', 'Mir200')
      );
    }

    return uniquePaths(mir200Roots.map(mir200Root => path.join(mir200Root, relativePath)));
  }

  const envirRelativePath = definition.envirRelativePath;
  if (!envirRelativePath) return [];
  const envirRoots: string[] = [];
  const activeEnvir = activeDocumentPath
    ? findNamedAncestor(path.dirname(activeDocumentPath), 'envir')
    : '';
  if (activeEnvir) envirRoots.push(activeEnvir);

  for (const root of [engineRoot, workspaceRoot]) {
    if (!root) continue;
    const baseName = path.basename(root).toLowerCase();
    if (baseName === 'envir') envirRoots.push(root);
    if (baseName === 'mir200') envirRoots.push(path.join(root, 'Envir'));
    envirRoots.push(
      path.join(root, 'Mir200', 'Envir'),
      path.join(root, 'Mirserver', 'Mir200', 'Envir')
    );
  }

  return uniquePaths(envirRoots.map(envirRoot => (
    path.join(envirRoot, envirRelativePath)
  )));
}

export function quickFileDisplayPath(definition: QuickFileDefinition): string {
  if (definition.mir200RelativePath) {
    return path.join('Mir200', platformRelativePath(definition.mir200RelativePath));
  }
  return path.join('Mir200', 'Envir', definition.envirRelativePath || '');
}

export function customQuickFilePathError(value: string): string | undefined {
  const prepared = prepareMir200RelativePath(value);
  if (!prepared) return '请输入相对于 Mir200 的文件路径';
  if (/[\\\/]$/.test(prepared)) return '请输入文件路径，不能以目录分隔符结尾';
  if (path.win32.isAbsolute(prepared) || prepared.startsWith('/')) {
    return '请输入相对于 Mir200 的路径，不能包含盘符或绝对路径';
  }

  const withoutPrefix = prepared.replace(/^mir200\//i, '');
  const segments = withoutPrefix.split('/').filter(segment => segment !== '' && segment !== '.');
  if (segments.length === 0) return '请输入 Mir200 目录内的文件路径';
  if (segments.some(segment => segment === '..')) return '路径不能使用 .. 跳出 Mir200 目录';
  if (segments.some(segment => /[<>:"|?*\x00-\x1f]/.test(segment))) {
    return '路径包含 Windows 文件名不支持的字符';
  }
  if (segments.some(segment => /[. ]$/.test(segment))) {
    return '文件夹名或文件名不能以空格或句点结尾';
  }
  return undefined;
}

export function normalizeMir200RelativePath(value: string): string | undefined {
  if (customQuickFilePathError(value)) return undefined;
  const prepared = prepareMir200RelativePath(value).replace(/^mir200\//i, '');
  return prepared
    .split('/')
    .filter(segment => segment !== '' && segment !== '.')
    .join('/');
}

export function normalizeCustomQuickFilePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeMir200RelativePath(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function createCustomQuickFileDefinition(relativePath: string): QuickFileDefinition {
  const normalized = normalizeMir200RelativePath(relativePath);
  if (!normalized) throw new Error('无效的 Mir200 相对路径');
  return {
    fileName: path.win32.basename(normalized.replace(/\//g, '\\')),
    description: '自定义快捷文件',
    mir200RelativePath: normalized,
    custom: true,
  };
}

function findNamedAncestor(startPath: string, directoryName: string): string {
  let current = path.resolve(startPath);
  const wanted = directoryName.toLowerCase();
  while (true) {
    if (path.basename(current).toLowerCase() === wanted) return current;
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = path.resolve(value);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function prepareMir200RelativePath(value: string): string {
  let result = value.trim();
  if (
    result.length >= 2
    && ((result.startsWith('"') && result.endsWith('"'))
      || (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result.replace(/\\/g, '/').replace(/^\.\//, '');
}

function platformRelativePath(value: string): string {
  return value.split('/').join(path.sep);
}
