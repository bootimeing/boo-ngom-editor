import * as path from 'path';

export type SavedMapMarkerFiles = Record<string, string>;

export function mapMarkerWorkspaceKey(workspaceRoot: string | undefined): string {
  const root = String(workspaceRoot || '').trim();
  return root ? path.resolve(root).toLocaleLowerCase() : '';
}

export function resolveSavedMapMarkerFile(
  workspaceValue: string | undefined,
  savedByWorkspace: SavedMapMarkerFiles,
  workspaceRoot: string | undefined
): string {
  const localValue = String(workspaceValue || '').trim();
  if (localValue) return path.resolve(localValue);
  const key = mapMarkerWorkspaceKey(workspaceRoot);
  const globalValue = key ? String(savedByWorkspace?.[key] || '').trim() : '';
  return globalValue ? path.resolve(globalValue) : '';
}

export function rememberMapMarkerFile(
  savedByWorkspace: SavedMapMarkerFiles,
  workspaceRoot: string | undefined,
  markerFile: string
): SavedMapMarkerFiles {
  const key = mapMarkerWorkspaceKey(workspaceRoot);
  if (!key) throw new Error('未打开工作区，无法保存地图标识路径');
  const filePath = String(markerFile || '').trim();
  if (!filePath) throw new Error('地图标识路径不能为空');
  return { ...savedByWorkspace, [key]: path.resolve(filePath) };
}
