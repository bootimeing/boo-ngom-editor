import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { readFileGBK } from './text';
import { WebviewMessage } from '../types';
import {
  buildPakImageIndex,
  getPakImagePath,
  pakImageIndexKey,
  PakImageIndexAsset,
} from './pak-image-index';
import { loadPakIndex } from './pak';
import {
  CachedPatchAssetTable,
  CachedPatchPak,
  findCachedPatchImage,
  loadCachedPatchAssetTable,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  SavedPatchManagerState,
} from './patch-cache';
import { getPatchCacheRoot } from './cache-storage';
import { getEngineDefinition, normalizeEngineId } from './engine-registry';
import {
  archiveResourceUri,
  cachedPatchImageUri,
  webviewResourceRoots,
} from './archive-resource-provider';
import { clientResourceLayoutFromState } from './client-resources';
import { ArchiveExtension } from './archive-types';
import { uiEditorArchiveExtensions } from './ui-archive';

let _sidebarView: vscode.WebviewView | undefined;
let _pakFolder: string | undefined;
let _extContext: vscode.ExtensionContext | undefined;
let _loadedPakImages = new Map<string, string>();
let _loadedArchiveImages = new Map<string, { archiveId: string; imageIndex: number }>();
let _loadedPakAssets = new Map<string, SidebarPakImageAsset>();
let _loadedPakResourceRoots: string[] = [];
let _cachedPatchResourceRoots: string[] = [];
const _cachedPatchAssetTables = new Map<string, CachedPatchAssetTable>();
let _lastSidebarMessage: WebviewMessage | undefined;

interface SidebarPakImageAsset extends PakImageIndexAsset {
  archiveId?: string;
  imageIdx?: number;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface ResolvedSidebarImageAsset {
  url: string;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

export function setSidebarView(view: vscode.WebviewView | undefined) {
  _sidebarView = view;
  applySidebarResourceRoots();
}

export function setPakFolder(folder: string | undefined) {
  _pakFolder = folder;
  applySidebarResourceRoots();
}

export function setExtContext(ctx: vscode.ExtensionContext) { _extContext = ctx; }

export function setLoadedPakAssets(
  assets: SidebarPakImageAsset[]
) {
  _loadedPakImages = buildPakImageIndex(assets);
  _loadedPakAssets = new Map();
  for (const asset of assets) {
    const key = pakImageIndexKey(asset.willIdx, asset.localIdx);
    if (!_loadedPakAssets.has(key)) _loadedPakAssets.set(key, asset);
  }
  _loadedArchiveImages = new Map(assets
    .filter(asset => !!asset.archiveId)
    .map(asset => [
      pakImageIndexKey(asset.willIdx, asset.localIdx),
      {
        archiveId: asset.archiveId as string,
        imageIndex: Number.isInteger(asset.imageIdx) ? asset.imageIdx as number : asset.localIdx,
      },
    ]));
  _loadedPakResourceRoots = [...new Set(assets
    .filter(asset => !!asset.path)
    .map(asset => path.dirname(asset.path))
    .filter(folder => folder && fs.existsSync(folder)))];
  applySidebarResourceRoots();
}

export function clearArchiveResourceContext() {
  _pakFolder = undefined;
  _loadedPakImages.clear();
  _loadedArchiveImages.clear();
  _loadedPakAssets.clear();
  _loadedPakResourceRoots = [];
  _cachedPatchResourceRoots = [];
  _cachedPatchAssetTables.clear();
  applySidebarResourceRoots();
}

export function postToSidebar(data: WebviewMessage) {
  _lastSidebarMessage = data;
  if (_sidebarView) { _sidebarView.webview.postMessage(data); }
}

export function replaySidebarMessage() {
  applySidebarResourceRoots();
  if (_sidebarView && _lastSidebarMessage) {
    _sidebarView.webview.postMessage(_lastSidebarMessage);
  }
}

function applySidebarResourceRoots() {
  if (!_sidebarView) return;
  const roots = [
    _extContext?.extensionPath,
    _pakFolder,
    ..._loadedPakResourceRoots,
    ..._cachedPatchResourceRoots,
  ].filter((folder): folder is string => !!folder && fs.existsSync(folder));
  const uniqueRoots = [...new Map(roots.map(folder => {
    const resolved = path.resolve(folder);
    return [resolved.toLowerCase(), resolved];
  })).values()];
  _sidebarView.webview.options = {
    enableScripts: true,
    localResourceRoots: webviewResourceRoots(uniqueRoots),
  };
}

function tryAutoOpenFolder(): string {
  if (_pakFolder) return _pakFolder;
  try {
    const history: string[] = _extContext?.workspaceState?.get?.('boo.folderHistory') || [];
    if (history.length > 0 && fs.existsSync(history[0])) {
      _pakFolder = history[0];
      applySidebarResourceRoots();
      return history[0];
    }
  } catch (e) {
    console.warn('[BOO] 自动打开文件夹失败:', e instanceof Error ? e.message : String(e));
  }
  return '';
}

function readPakIndex(folder: string): Map<number, string> {
  const map = new Map<number, string>();
  try {
    const effFile = path.join(folder, 'EffectImageList.txt');
    if (!fs.existsSync(effFile)) {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) {
        const index = loadPakIndex(wsRoot);
        if (index) return new Map(index.pakMap);
      }
    }
    if (!fs.existsSync(effFile)) return map;
    const buf = fs.readFileSync(effFile);
    const text = readFileGBK(new Uint8Array(buf));
    const lines = text.split(/\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const configuredName = lines[i].trim().replace(/[\\/]+/g, path.sep);
      const name = path.basename(configuredName).replace(/\.(?:pak|jpk|wil|wzl)$/i, '');
      if (name) map.set(i, name);
    }
  } catch (e) {
    console.warn('[BOO] 读取PAK索引失败:', e instanceof Error ? e.message : String(e));
  }
  return map;
}

export function resolvePakImage(wil: number, idx: number): string {
  return resolvePakImageAsset(wil, idx).url;
}

export function resolvePakImageAsset(wil: number, idx: number): ResolvedSidebarImageAsset {
  if (!_sidebarView) return { url: '' };
  const imageKey = pakImageIndexKey(wil, idx);
  const loadedAsset = _loadedPakAssets.get(imageKey);
  const directImage = _loadedArchiveImages.get(imageKey);
  if (directImage) {
    applySidebarResourceRoots();
    const url = _sidebarView.webview.asWebviewUri(
      archiveResourceUri(directImage.archiveId, directImage.imageIndex)
    ).toString();
    return resolvedImageAsset(url, loadedAsset);
  }
  const loadedPakImage = getPakImagePath(_loadedPakImages, wil, idx);
  if (loadedPakImage && fs.existsSync(loadedPakImage)) {
    applySidebarResourceRoots();
    const url = _sidebarView.webview.asWebviewUri(vscode.Uri.file(loadedPakImage)).toString();
    return resolvedImageAsset(url, loadedAsset);
  }
  const cachedPatchImage = resolveCachedPatchImageAsset(wil, idx);
  if (cachedPatchImage.url) return cachedPatchImage;
  const folder = tryAutoOpenFolder();
  if (!folder) return { url: '' };
  const pakMap = readPakIndex(folder);
  const pakName = pakMap.get(wil);
  applySidebarResourceRoots();
  const padded = String(idx).padStart(6, '0');
  if (pakName && fs.existsSync(path.join(folder, pakName))) {
    const pakDir = path.join(folder, pakName);
    for (const ext of ['.png', '.bmp', '.gif', '.jpg']) {
      const fp = path.join(pakDir, padded + ext);
      if (fs.existsSync(fp)) return { url: _sidebarView.webview.asWebviewUri(vscode.Uri.file(fp)).toString() };
    }
    for (const pad of [5,4,3,2,1,0]) {
      const p = pad > 0 ? String(idx).padStart(pad, '0') : String(idx);
      for (const ext of ['.png', '.bmp', '.gif', '.jpg']) {
        const fp = path.join(pakDir, p + ext);
        if (fs.existsSync(fp)) return { url: _sidebarView.webview.asWebviewUri(vscode.Uri.file(fp)).toString() };
      }
    }
  }
  const subs = fs.readdirSync(folder).filter((f: string) => { try { return fs.statSync(path.join(folder, f)).isDirectory(); } catch (e) { console.warn('[BOO] 检查目录失败:', e instanceof Error ? e.message : String(e)); return false; } });
  for (const sub of subs) {
    const subPath = path.join(folder, sub);
    for (const pad of [6,5,4,3,2,1,0]) {
      const p = pad > 0 ? String(idx).padStart(pad, '0') : String(idx);
      for (const ext of ['.png', '.bmp', '.gif', '.jpg']) {
        const fp = path.join(subPath, p + ext);
        if (fs.existsSync(fp)) return { url: _sidebarView.webview.asWebviewUri(vscode.Uri.file(fp)).toString() };
      }
    }
  }
  return { url: '' };
}

function resolveCachedPatchImageAsset(wil: number, idx: number): ResolvedSidebarImageAsset {
  if (!_sidebarView || !_extContext) return { url: '' };
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return { url: '' };
  const entry = loadPakIndex(workspaceRoot)?.pakList.find(item => item.willIdx === wil);
  if (!entry) return { url: '' };
  const pakName = entry.extension ? `${entry.name}.${entry.extension}` : entry.name;
  return resolveCachedPatchPakImageAsset(
    pakName,
    idx,
    entry.extension ? [entry.extension] : undefined
  );
}

export function resolveCachedPatchPakImage(pakName: string, idx: number): string {
  return resolveCachedPatchPakImageAsset(pakName, idx).url;
}

export function resolveCachedPatchPakImageAsset(
  pakName: string,
  idx: number,
  archiveExtensions?: readonly ArchiveExtension[]
): ResolvedSidebarImageAsset {
  if (!_sidebarView || !_extContext) return { url: '' };
  const engine = normalizeEngineId(
    vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
  );
  const definition = getEngineDefinition(engine);
  const state = _extContext.workspaceState.get<SavedPatchManagerState>(
    patchManagerStateKey(engine)
  ) || _extContext.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
  const belongsToEngine = state && (!state.engine || state.engine === engine);
  const resourceRoots = belongsToEngine
    ? clientResourceLayoutFromState(state)?.dataRoots || []
    : [];
  const cacheRoot = getPatchCacheRoot(_extContext);
  const match = findCachedPatchImage(
    cacheRoot,
    pakName,
    idx,
    resourceRoots,
    archiveExtensions || uiEditorArchiveExtensions(definition.id)
  );
  if (!match) return { url: '' };
  if (match.imagePath && !_cachedPatchResourceRoots.includes(match.pak.cacheDir)) {
    _cachedPatchResourceRoots.push(match.pak.cacheDir);
  }
  applySidebarResourceRoots();
  const url = _sidebarView.webview.asWebviewUri(cachedPatchImageUri(match)).toString();
  return resolvedImageAsset(url, cachedPatchImageMetadata(match.pak, match.imageIndex));
}

function cachedPatchImageMetadata(
  pak: CachedPatchPak,
  imageIndex: number
): Omit<ResolvedSidebarImageAsset, 'url'> | undefined {
  try {
    const key = `${pak.manifestPath}|${pak.archiveId || ''}|${pak.cachedAt}`;
    let table = _cachedPatchAssetTables.get(key);
    if (!table) {
      table = loadCachedPatchAssetTable(pak);
      if (_cachedPatchAssetTables.size >= 64) _cachedPatchAssetTables.clear();
      _cachedPatchAssetTables.set(key, table);
    }
    if (imageIndex < 0 || imageIndex >= table.slotCount || !table.present[imageIndex]) return undefined;
    return {
      width: table.width[imageIndex],
      height: table.height[imageIndex],
      offsetX: table.offsetX[imageIndex],
      offsetY: table.offsetY[imageIndex],
    };
  } catch {
    return undefined;
  }
}

function resolvedImageAsset(
  url: string,
  asset?: Partial<ResolvedSidebarImageAsset>
): ResolvedSidebarImageAsset {
  const result: ResolvedSidebarImageAsset = { url };
  for (const key of ['width', 'height', 'offsetX', 'offsetY'] as const) {
    const value = asset?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}
