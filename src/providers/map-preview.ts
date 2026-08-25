import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EngineId } from '../types';
import {
  findMiniMapReferenceByPriority,
  loadMiniMapIndex,
  miniMapArchiveCandidates,
  MiniMapReference,
} from '../utils/minimap';
import {
  CachedPatchAssetTable,
  CachedPatchArchiveResolution,
  CachedPatchPak,
  findCachedPatchImage,
  findUniqueCurrentCachedPatchPakByName,
  isPatchCacheCurrent,
  listCachedPatchPaks,
  loadCachedPatchAssetTable,
  PATCH_MANAGER_STATE_KEY,
  patchImagePath,
  patchManagerStateKey,
  resolveCachedPatchArchiveByName,
  SavedPatchManagerState,
} from '../utils/patch-cache';
import { getPatchCacheRoot } from '../utils/cache-storage';
import {
  ARCHIVE_RESOURCE_ROOT,
  archiveResourceUri,
  cachedPatchImageUri,
} from '../utils/archive-resource-provider';
import {
  appendMapMarkerLines,
  deleteMapMarkerLine,
  MapDimensions,
  MapInfoEntry,
  MapMarkerUpdate,
  markerMatchesMap,
  parseMapInfoText,
  parseMapMarkerText,
  readClassicMapDimensions,
  updateMapMarkerLine,
} from '../utils/map-preview';
import {
  decodeTextFile,
  encodeTextFile,
  readFileGBK,
} from '../utils/text';
import { secureWebviewHtml } from '../utils/webview-security';
import {
  rememberMapMarkerFile,
  resolveSavedMapMarkerFile,
  SavedMapMarkerFiles,
} from '../utils/map-marker-state';
import { getEngineDefinition, normalizeEngineId } from '../utils/engine-registry';
import { uiEditorArchiveExtensions } from '../utils/ui-archive';
import {
  clientResourceLayoutFromState,
  ClientResourceLayout,
  resolveResourceFile,
  scanClientArchiveFiles,
} from '../utils/client-resources';
import { ArchiveExtension } from '../utils/archive-types';
import { clearPakCache, loadPakIndex } from '../utils/pak';
import {
  collectOriginalMapViewport,
  OriginalMapDrawReference,
  OriginalMapModel,
  parseOriginalMap,
} from '../utils/original-map';
import {
  engineColor,
  findCustomNpcConfig,
  findEnvirDirectory,
  findMir200Directory,
  mapEntityMatches,
  formatNpcDisplayName,
  MapSafeZone,
  merchantColumns,
  MerchantNpc,
  monGenColumns,
  MonsterSpawn,
  parseCustomNpcAnimation,
  parseMerchantNameColor,
  parseMerchantText,
  parseMonGenText,
  parseStartPointText,
  resolveMerchantScriptPath,
  selectCustomNpcArchive,
  updateMerchantNpc,
  updateMonGenFields,
} from '../utils/map-entities';
import { buildMonsterIconPreviews } from '../utils/database-detail';
import {
  loadNpcIconDetail,
  NpcIconConfig,
  saveNpcIconText,
  validateNpcIconText,
} from '../utils/npc-icons';
import {
  officialNpcArchiveBaseName,
  resolveOfficialNpcAnimationPlan,
  selectOfficialNpcArchiveFile,
} from '../utils/official-npc';

const MARKER_FILE_STATE_KEY = 'boo.mapPreview.markerFile';
const MARKER_FILE_PATHS_STATE_KEY = 'boo.mapPreview.markerFilesByWorkspace';

interface MapPreviewMessage {
  type?: string;
  key?: string;
  requestId?: number;
  marker?: {
    lineNumber?: number;
    mapName?: string;
    x?: number;
    y?: number;
    text?: string;
    colorSource?: string;
    mode?: number;
    modes?: number[];
  };
  npc?: {
    lineNumber?: number;
    x?: number;
    y?: number;
    appearance?: number;
    iconText?: string;
    targetMapKey?: string;
  };
  spawn?: {
    lineNumber?: number;
    fields?: string[];
  };
}

interface ResolvedNpcFrame {
  url: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  usesOffsets: boolean;
  placementX?: number;
  placementY?: number;
}

interface ResolvedMapNpc extends MerchantNpc {
  nameColor: string;
  displayLabel: string;
  frames: ResolvedNpcFrame[];
  frameInterval: number;
  appearanceLabel: string;
  iconText: string;
  iconFileName: string;
  iconExists: boolean;
  icons: ResolvedNpcIcon[];
  scriptAvailable: boolean;
}

interface ResolvedNpcIcon extends NpcIconConfig {
  frames: ResolvedNpcFrame[];
  previewTruncated: boolean;
}

interface ResolvedMapSafeZone extends MapSafeZone {
  frames: ResolvedNpcFrame[];
  frameInterval: number;
  resourceLabel: string;
}

interface NpcResolutionContext {
  envirDirectory: string;
  engine: EngineId;
  nameColor: string;
  resourceRoots: Set<string>;
  clientLayout: ClientResourceLayout | undefined;
  patchPaks: CachedPatchPak[];
  officialArchiveFiles: string[];
  effectImageArchives: { name: string; willIdx: number; extension?: string }[];
  customAnimations: Map<number, ResolvedNpcAnimation>;
  officialAnimations: Map<number, ResolvedNpcAnimation>;
  safeZoneAnimations: Map<number, ResolvedNpcAnimation>;
}

interface ResolvedNpcAnimation {
  frames: ResolvedNpcFrame[];
  interval: number;
  label: string;
}

interface OriginalMapSession {
  mapKey: string;
  filePath: string;
  model: OriginalMapModel;
  data?: OriginalMapData;
}

interface ResolvedOriginalResource {
  key: string;
  url: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

type OriginalArchiveResolution = CachedPatchArchiveResolution
  | { status: 'shared-cache'; sourcePath: string; pak: CachedPatchPak };

interface OriginalMapData {
  resources: ResolvedOriginalResource[];
  tiles: number[];
  smTiles: number[];
  objects: number[];
  warning: string;
}

interface MerchantNpcReveal {
  mapKey: string;
  lineNumber: number;
  x: number;
  y: number;
  displayName: string;
}

export class MapPreviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private panelReady = false;
  private maps: MapInfoEntry[] = [];
  private currentMap: MapInfoEntry | undefined;
  private markerFile: string;
  private markerSaveQueue: Promise<void> = Promise.resolve();
  private entitySaveQueue: Promise<void> = Promise.resolve();
  private originalMapSession: OriginalMapSession | undefined;
  private originalMapVersion = 0;
  private readonly originalAssetTables = new Map<string, CachedPatchAssetTable>();
  private pendingNpcReveal: MerchantNpcReveal | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.markerFile = '';
    this.restoreMarkerFilePath();
    this.reloadMaps();
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.restoreMarkerFilePath();
      this.reloadMaps();
      this.postSidebarState();
      this.postCurrentMap();
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('boo.engine')) return;
      this.currentMap = undefined;
      this.pendingNpcReveal = undefined;
      this.clearOriginalMapSession();
      this.panel?.dispose();
      this.reloadMaps();
      this.postSidebarState();
    }));
  }

  async revealMerchantNpc(sourceUri: unknown, lineNumberValue: unknown): Promise<void> {
    if (!this.isSupported()) {
      void vscode.window.showWarningMessage('当前引擎的地图预览规则尚未完成验收。');
      return;
    }
    const lineNumber = Number(lineNumberValue);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      void vscode.window.showWarningMessage('无法定位 Merchant.txt 中的 NPC 行');
      return;
    }
    let uri: vscode.Uri | undefined;
    try {
      if (typeof sourceUri === 'string' && sourceUri) {
        uri = sourceUri.includes('://') ? vscode.Uri.parse(sourceUri) : vscode.Uri.file(sourceUri);
      } else if (sourceUri && typeof sourceUri === 'object' && 'scheme' in sourceUri) {
        uri = sourceUri as vscode.Uri;
      } else {
        uri = vscode.window.activeTextEditor?.document.uri;
      }
    } catch {
      uri = undefined;
    }
    if (!uri || path.basename(uri.fsPath).toLowerCase() !== 'merchant.txt') {
      void vscode.window.showWarningMessage('地图定位仅支持 Merchant.txt 中的 NPC');
      return;
    }
    try {
      const opened = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri?.toString());
      const document = opened || await vscode.workspace.openTextDocument(uri);
      const npc = parseMerchantText(document.getText()).find(item => item.lineNumber === lineNumber);
      if (!npc) {
        void vscode.window.showWarningMessage(`Merchant.txt 第 ${lineNumber} 行不是有效的 NPC 配置`);
        return;
      }
      this.reloadMaps();
      const map = this.maps.find(entry => mapEntityMatches(npc.mapName, entry));
      if (!map) {
        void vscode.window.showWarningMessage(`MapInfo.txt 中未找到 NPC 地图：${npc.mapName}`);
        return;
      }
      const reveal: MerchantNpcReveal = {
        mapKey: map.key,
        lineNumber: npc.lineNumber,
        x: npc.x,
        y: npc.y,
        displayName: npc.displayName,
      };
      if (this.currentMap?.key === map.key && this.panel && this.panelReady) {
        this.panel.reveal(vscode.ViewColumn.Active, false);
        void this.panel.webview.postMessage({
          type: 'revealMerchantNpc',
          npc: reveal,
        });
        this.postSidebarState();
        return;
      }
      this.pendingNpcReveal = reveal;
      this.openMap(map, false);
    } catch (error) {
      void vscode.window.showWarningMessage(
        `无法打开 NPC 原始地图：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = secureWebviewHtml(
      webviewView.webview,
      this.sidebarHtml()
    );
    webviewView.webview.onDidReceiveMessage(message => {
      void this.handleSidebarMessage(message as MapPreviewMessage);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });
  }

  private async handleSidebarMessage(message: MapPreviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.restoreMarkerFilePath();
      this.reloadMaps();
      this.postSidebarState();
      return;
    }
    if (message.type === 'importMarkers') {
      await this.importMarkerFile();
      return;
    }
    if (message.type === 'refresh') {
      this.reloadMaps();
      this.postSidebarState();
      this.postCurrentMap();
      return;
    }
    if (message.type === 'openMap' && message.key) {
      if (!this.isSupported()) {
        vscode.window.showWarningMessage('当前引擎的地图预览规则尚未完成验收。');
        return;
      }
      const selected = this.maps.find(map => map.key === message.key);
      if (selected) this.openMap(selected);
    }
  }

  private reloadMaps(): void {
    if (!this.isSupported()) {
      this.maps = [];
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mapInfoPath = workspaceRoot ? findEnvirFile(workspaceRoot, 'MapInfo.txt') : undefined;
    if (!mapInfoPath) {
      this.maps = [];
      return;
    }
    try {
      this.maps = parseMapInfoText(readFileGBK(fs.readFileSync(mapInfoPath)));
    } catch (error) {
      this.maps = [];
      console.warn('[BOO] 地图预览读取 MapInfo.txt 失败:', error instanceof Error ? error.message : String(error));
    }
  }

  private async importMarkerFile(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      void vscode.window.showWarningMessage('请先打开传奇服务端工作区，再导入小地图标识文件');
      return;
    }
    const defaultDirectory = isFile(this.markerFile)
      ? path.dirname(this.markerFile)
      : workspaceRoot
        ? path.dirname(findEnvirFile(workspaceRoot, 'MapInfo.txt') || workspaceRoot)
        : undefined;
    const selected = await vscode.window.showOpenDialog({
      title: '导入小地图标识文件',
      openLabel: '导入小地图标识',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { '地图标识文件': ['txt', 'dat'] },
      defaultUri: defaultDirectory ? vscode.Uri.file(defaultDirectory) : undefined,
    });
    if (!selected?.[0]) return;
    this.markerFile = path.resolve(selected[0].fsPath);
    const savedByWorkspace = this.context.globalState.get<SavedMapMarkerFiles>(MARKER_FILE_PATHS_STATE_KEY, {});
    const updatedPaths = rememberMapMarkerFile(savedByWorkspace, workspaceRoot, this.markerFile);
    await Promise.all([
      this.context.workspaceState.update(MARKER_FILE_STATE_KEY, this.markerFile),
      this.context.globalState.update(MARKER_FILE_PATHS_STATE_KEY, updatedPaths),
    ]);
    this.postSidebarState();
    this.postCurrentMap();
  }

  private restoreMarkerFilePath(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const workspaceValue = this.context.workspaceState.get<string>(MARKER_FILE_STATE_KEY, '');
    const savedByWorkspace = this.context.globalState.get<SavedMapMarkerFiles>(MARKER_FILE_PATHS_STATE_KEY, {});
    this.markerFile = resolveSavedMapMarkerFile(workspaceValue, savedByWorkspace, workspaceRoot);
  }

  private openMap(map: MapInfoEntry, preserveFocus = true): void {
    if (this.currentMap?.key !== map.key) this.clearOriginalMapSession();
    this.currentMap = map;
    if (!this.panel) {
      this.panelReady = false;
      this.panel = vscode.window.createWebviewPanel(
        'booMapPreview',
        `地图预览 - ${map.name}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            this.context.extensionUri,
            vscode.Uri.file(getPatchCacheRoot(this.context)),
            ARCHIVE_RESOURCE_ROOT,
          ],
        }
      );
      const htmlPath = path.join(this.context.extensionPath, 'media', 'map-preview.html');
      this.panel.webview.html = secureWebviewHtml(
        this.panel.webview,
        fs.readFileSync(htmlPath, 'utf8')
      );
      this.panel.webview.onDidReceiveMessage(message => {
        if (message?.type === 'ready') {
          this.panelReady = true;
          this.postCurrentMap();
        } else if (message?.type === 'refresh') {
          this.postCurrentMap();
        } else if (message?.type === 'updateMarker') {
          this.enqueueMarkerUpdate(message as MapPreviewMessage);
        } else if (message?.type === 'addMarkers') {
          this.enqueueMarkerAddition(message as MapPreviewMessage);
        } else if (message?.type === 'deleteMarker') {
          void this.requestMarkerDeletion(message as MapPreviewMessage);
        } else if (message?.type === 'loadOriginalMap') {
          void this.loadOriginalMap(message as MapPreviewMessage);
        } else if (message?.type === 'cancelOriginalMap') {
          this.originalMapVersion++;
        } else if (message?.type === 'updateNpc') {
          this.enqueueNpcUpdate(message as MapPreviewMessage);
        } else if (message?.type === 'moveNpcToMap') {
          this.enqueueNpcMove(message as MapPreviewMessage);
        } else if (message?.type === 'updateSpawn') {
          this.enqueueSpawnUpdate(message as MapPreviewMessage);
        } else if (message?.type === 'openNpcScript') {
          void this.openNpcScript(message as MapPreviewMessage);
        }
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.panelReady = false;
        this.clearOriginalMapSession();
      });
    } else {
      this.panel.title = `地图预览 - ${map.name}`;
      this.panel.reveal(vscode.ViewColumn.Active, preserveFocus);
      this.postCurrentMap();
    }
    this.postSidebarState();
  }

  private postSidebarState(): void {
    if (!this.view) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mapInfoPath = workspaceRoot ? findEnvirFile(workspaceRoot, 'MapInfo.txt') : undefined;
    void this.view.webview.postMessage({
      type: 'state',
      maps: this.maps.map(map => ({
        key: map.key,
        mapId: map.mapId,
        originalMapId: map.originalMapId,
        name: map.name,
      })),
      activeKey: this.currentMap?.key || '',
      markerFile: this.markerFile ? path.basename(this.markerFile) : '',
      markerFilePath: this.markerFile,
      markerFileMissing: Boolean(this.markerFile) && !isFile(this.markerFile),
      mapInfoFound: Boolean(mapInfoPath),
      engineSupported: this.isSupported(),
    });
  }

  private isSupported(): boolean {
    const engine = vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM');
    return getEngineDefinition(engine).mapPreviewVerified;
  }

  private postCurrentMap(): void {
    if (!this.panel || !this.panelReady || !this.currentMap) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const map = this.currentMap;
    const miniMapIndex = loadMiniMapIndex(workspaceRoot);
    const reference = findMiniMapReferenceByPriority(
      miniMapIndex,
      [map.originalMapId, map.mapId]
    );
    const engine = normalizeEngineId(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    const dimensions = findMapDimensions(
      workspaceRoot,
      [map.originalMapId, map.mapId],
      this.clientResourceLayout(engine)?.mapRoots || []
    );
    const markers = this.readMarkers().filter(marker => markerMatchesMap(marker, map));
    const cachedImage = reference ? this.resolveMiniMapImage(reference) : undefined;
    const archiveExtension = getEngineDefinition(engine).archiveExtensions[0];
    const entities = this.readMapEntities(workspaceRoot, map, engine);
    const revealNpc = this.pendingNpcReveal?.mapKey === map.key
      ? {
        lineNumber: this.pendingNpcReveal.lineNumber,
        x: this.pendingNpcReveal.x,
        y: this.pendingNpcReveal.y,
        displayName: this.pendingNpcReveal.displayName,
      }
      : undefined;
    if (revealNpc) this.pendingNpcReveal = undefined;

    let warning = '';
    if (!reference) {
      warning = `MiniMap.txt 未配置 ${map.originalMapId} 或 ${map.mapId}`;
    } else if (!cachedImage) {
      warning = `${reference.pakName}.${archiveExtension} / ${String(reference.imageIndex).padStart(6, '0')} 未缓存`;
    } else if (!dimensions) {
      warning = '未找到原始 .map，标识坐标暂按小地图图片尺寸显示';
    }

    const localResourceRoots = [
      this.context.extensionUri,
      vscode.Uri.file(getPatchCacheRoot(this.context)),
      ARCHIVE_RESOURCE_ROOT,
    ];
    if (cachedImage?.imagePath) localResourceRoots.push(vscode.Uri.file(cachedImage.pak.cacheDir));
    for (const cacheDir of entities.resourceRoots) {
      localResourceRoots.push(vscode.Uri.file(cacheDir));
    }
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };
    const imageUrl = cachedImage
      ? this.panel.webview.asWebviewUri(cachedPatchImageUri(cachedImage)).toString()
      : '';
    void this.panel.webview.postMessage({
      type: 'mapData',
      map: {
        mapId: map.mapId,
        originalMapId: map.originalMapId,
        name: map.name,
        width: dimensions?.width || 0,
        height: dimensions?.height || 0,
      },
      maps: this.maps.map(entry => ({
        key: entry.key,
        mapId: entry.mapId,
        originalMapId: entry.originalMapId,
        name: entry.name,
      })),
      imageUrl,
      miniMapPak: reference?.pakName || '',
      miniMapIndex: reference?.imageIndex ?? -1,
      markers,
      npcs: entities.npcs,
      spawns: entities.spawns,
      safeZones: entities.safeZones,
      merchantColumns: merchantColumns(
        entities.npcs.reduce((count, npc) => Math.max(count, npc.fields.length), 0)
      ),
      monGenColumns: monGenColumns(
        engine,
        entities.spawns.reduce((count, spawn) => Math.max(count, spawn.fields.length), 0)
      ),
      engine,
      entityWarnings: entities.warnings,
      revealNpc,
      markerFile: isFile(this.markerFile) ? path.basename(this.markerFile) : '',
      warning,
    });
  }

  private readMarkers(): ReturnType<typeof parseMapMarkerText> {
    if (!isFile(this.markerFile)) return [];
    try {
      return parseMapMarkerText(decodeTextFile(fs.readFileSync(this.markerFile)).text);
    } catch (error) {
      console.warn('[BOO] 地图预览读取标识文件失败:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private readMapEntities(
    workspaceRoot: string,
    map: MapInfoEntry,
    engine: EngineId
  ): {
    npcs: ResolvedMapNpc[];
    spawns: MonsterSpawn[];
    safeZones: ResolvedMapSafeZone[];
    resourceRoots: string[];
    warnings: string[];
  } {
    const envirDirectory = findEnvirDirectory(workspaceRoot);
    const mir200Directory = findMir200Directory(workspaceRoot);
    const resourceRoots = new Set<string>();
    const warnings: string[] = [];
    if (!envirDirectory || !mir200Directory) {
      return { npcs: [], spawns: [], safeZones: [], resourceRoots: [], warnings: ['未找到 Mir200\\Envir'] };
    }

    const merchantPath = path.join(envirDirectory, 'Merchant.txt');
    const monGenPath = path.join(envirDirectory, 'MonGen.txt');
    const startPointPath = path.join(envirDirectory, 'StartPoint.txt');
    const setupPath = path.join(mir200Directory, '!Setup.txt');
    const merchantText = readOptionalText(merchantPath);
    const monGenText = readOptionalText(monGenPath);
    const startPointText = readOptionalText(startPointPath);
    const setupText = readOptionalText(setupPath);
    if (merchantText === undefined) warnings.push('未找到 Merchant.txt');
    if (monGenText === undefined) warnings.push('未找到 MonGen.txt');
    if (startPointText === undefined) warnings.push('未找到 StartPoint.txt');

    clearPakCache();
    const context = this.createNpcResolutionContext(
      workspaceRoot,
      envirDirectory,
      engine,
      engineColor(parseMerchantNameColor(setupText || '')),
      resourceRoots
    );
    const npcs = (merchantText === undefined ? [] : parseMerchantText(merchantText))
      .filter(npc => mapEntityMatches(npc.mapName, map))
      .map(npc => this.resolveMapNpc(npc, context));
    const spawns = (monGenText === undefined ? [] : parseMonGenText(monGenText))
      .filter(spawn => mapEntityMatches(spawn.mapName, map));
    const safeZones = (startPointText === undefined ? [] : parseStartPointText(startPointText, engine))
      .filter(zone => mapEntityMatches(zone.mapName, map))
      .map(zone => this.resolveMapSafeZone(zone, context));
    if (safeZones.some(zone => zone.customResource && zone.frames.length === 0)) {
      warnings.push('安全区自定义素材 SafePointEffect 未缓存');
    }
    return { npcs, spawns, safeZones, resourceRoots: [...resourceRoots], warnings };
  }

  private createNpcResolutionContext(
    workspaceRoot: string,
    envirDirectory: string,
    engine: EngineId,
    nameColor: string,
    resourceRoots = new Set<string>()
  ): NpcResolutionContext {
    const clientLayout = this.clientResourceLayout(engine);
    return {
      envirDirectory,
      engine,
      nameColor,
      resourceRoots,
      clientLayout,
      patchPaks: this.activePatchPaks(engine, clientLayout),
      officialArchiveFiles: this.officialNpcArchiveFiles(clientLayout),
      effectImageArchives: loadPakIndex(workspaceRoot)?.pakList || [],
      customAnimations: new Map<number, ResolvedNpcAnimation>(),
      officialAnimations: new Map<number, ResolvedNpcAnimation>(),
      safeZoneAnimations: new Map<number, ResolvedNpcAnimation>(),
    };
  }

  private resolveMapSafeZone(zone: MapSafeZone, context: NpcResolutionContext): ResolvedMapSafeZone {
    if (!zone.customResource) {
      return {
        ...zone,
        frames: [],
        frameInterval: 0,
        resourceLabel: zone.styleLabel,
      };
    }
    let animation = context.safeZoneAnimations.get(zone.haloType);
    if (!animation) {
      animation = this.resolveSafeZoneAnimation(zone.haloType, context);
      context.safeZoneAnimations.set(zone.haloType, animation);
    }
    return {
      ...zone,
      frames: animation.frames,
      frameInterval: animation.interval,
      resourceLabel: animation.label,
    };
  }

  private resolveSafeZoneAnimation(
    haloType: number,
    context: NpcResolutionContext
  ): ResolvedNpcAnimation {
    if (context.engine !== 'GEE' || haloType < 20 || haloType > 75 || !this.panel) {
      return { frames: [], interval: 0, label: `安全区样式 ${haloType}` };
    }
    const supportedExtensions = uiEditorArchiveExtensions(context.engine);
    let sourcePath = '';
    for (const extension of supportedExtensions) {
      sourcePath = resolveResourceFile(
        context.clientLayout?.dataRoots || [],
        ['SafePointEffect'],
        `.${extension}`
      ) || '';
      if (sourcePath) break;
    }
    const pak = sourcePath
      ? context.patchPaks.find(candidate => sameFilePath(candidate.pakPath, sourcePath))
      : context.patchPaks.find(candidate => (
        path.basename(candidate.pakPath, path.extname(candidate.pakPath)).toLowerCase() === 'safepointeffect'
      ));
    if (!pak || !isPatchCacheCurrent(pak)) {
      return { frames: [], interval: 0, label: 'SafePointEffect 未缓存' };
    }
    let table: CachedPatchAssetTable;
    try {
      table = this.originalAssetTable(pak);
    } catch (error) {
      console.warn('[BOO] 安全区素材索引读取失败:', error instanceof Error ? error.message : String(error));
      return { frames: [], interval: 0, label: 'SafePointEffect 索引不可用' };
    }
    const startIndex = (haloType - 20) * 10;
    const frames: ResolvedNpcFrame[] = [];
    for (let offset = 0; offset < 10; offset++) {
      const imageIndex = startIndex + offset;
      if (imageIndex >= pak.slotCount || imageIndex >= table.slotCount) break;
      if (!table.present[imageIndex] || table.blank[imageIndex]) continue;
      const imagePath = patchImagePath(pak, imageIndex);
      if (!pak.archiveId && !isFile(imagePath)) continue;
      frames.push({
        url: this.panel.webview.asWebviewUri(
          pak.archiveId
            ? archiveResourceUri(pak.archiveId, imageIndex)
            : vscode.Uri.file(imagePath)
        ).toString(),
        width: table.width[imageIndex] || 1,
        height: table.height[imageIndex] || 1,
        offsetX: table.offsetX[imageIndex] || 0,
        offsetY: table.offsetY[imageIndex] || 0,
        usesOffsets: true,
      });
    }
    if (!pak.archiveId) context.resourceRoots.add(pak.cacheDir);
    return {
      frames,
      interval: frames.length > 1 ? 120 : 0,
      label: `${path.basename(pak.pakPath)} · ${String(startIndex).padStart(6, '0')}-${String(startIndex + 9).padStart(6, '0')} · ${frames.length}/10 帧`,
    };
  }

  private resolveMapNpc(npc: MerchantNpc, context: NpcResolutionContext): ResolvedMapNpc {
    const cache = npc.appearance < 10000
      ? context.officialAnimations
      : context.customAnimations;
    let animation = cache.get(npc.appearance);
    if (!animation) {
      animation = npc.appearance < 10000
        ? this.resolveOfficialNpcAnimation(
          npc.appearance,
          context.engine,
          context.resourceRoots,
          context.clientLayout,
          context.officialArchiveFiles,
          context.patchPaks
        )
        : this.resolveCustomNpcAnimation(
          context.envirDirectory,
          npc.appearance,
          context.engine,
          context.patchPaks,
          context.effectImageArchives,
          context.resourceRoots
        );
      cache.set(npc.appearance, animation);
    }

    const iconDetail = loadNpcIconDetail(context.envirDirectory, npc, context.engine);
    return {
      ...npc,
      nameColor: context.nameColor,
      displayLabel: formatNpcDisplayName(npc.displayName) || npc.displayName || 'NPC',
      frames: animation.frames,
      frameInterval: animation.interval,
      appearanceLabel: animation.label,
      iconText: iconDetail.text,
      iconFileName: iconDetail.fileName,
      iconExists: iconDetail.exists,
      icons: this.resolveNpcIconPreviews(iconDetail.icons, context),
      scriptAvailable: Boolean(resolveMerchantScriptPath(context.envirDirectory, npc)),
    };
  }

  private resolveNpcIconPreviews(
    icons: NpcIconConfig[],
    context: NpcResolutionContext
  ): ResolvedNpcIcon[] {
    const archiveByWill = new Map<number, CachedPatchPak | undefined>();
    const tableByArchive = new Map<string, CachedPatchAssetTable | undefined>();
    const preview = buildMonsterIconPreviews(icons, (wilIndex, imageIndex) => {
      let pak = archiveByWill.get(wilIndex);
      if (!archiveByWill.has(wilIndex)) {
        pak = selectCustomNpcArchive(
          wilIndex,
          context.effectImageArchives,
          context.patchPaks
        ).archive;
        archiveByWill.set(wilIndex, pak);
      }
      if (!pak || !this.panel || imageIndex < 0 || imageIndex >= pak.slotCount) return { url: '' };

      const archiveKey = path.resolve(pak.pakPath).toLocaleLowerCase();
      let table = tableByArchive.get(archiveKey);
      if (!tableByArchive.has(archiveKey)) {
        try {
          table = this.originalAssetTable(pak);
        } catch (error) {
          console.warn('[BOO] NPC 顶戴素材索引读取失败:', error instanceof Error ? error.message : String(error));
          table = undefined;
        }
        tableByArchive.set(archiveKey, table);
      }
      const imagePath = patchImagePath(pak, imageIndex);
      if (!pak.archiveId && !isFile(imagePath)) return { url: '' };
      if (!pak.archiveId) context.resourceRoots.add(pak.cacheDir);
      const hasMetadata = Boolean(
        table
        && imageIndex < table.slotCount
        && table.present[imageIndex]
        && table.width[imageIndex] > 0
        && table.height[imageIndex] > 0
      );
      return {
        url: this.panel.webview.asWebviewUri(
          pak.archiveId
            ? archiveResourceUri(pak.archiveId, imageIndex)
            : vscode.Uri.file(imagePath)
        ).toString(),
        width: hasMetadata ? table!.width[imageIndex] : 0,
        height: hasMetadata ? table!.height[imageIndex] : 0,
        offsetX: hasMetadata ? table!.offsetX[imageIndex] : 0,
        offsetY: hasMetadata ? table!.offsetY[imageIndex] : 0,
      };
    });
    return preview.icons.map(icon => ({
      lineNumber: icon.lineNumber,
      raw: icon.raw,
      wilIndex: icon.wilIndex,
      imageIndex: icon.imageIndex,
      frameCount: icon.frameCount,
      x: icon.x,
      y: icon.y,
      effect: icon.effect,
      speedMs: icon.speedMs,
      playCount: icon.playCount,
      layer: icon.layer,
      frames: icon.frameAssets.map(asset => ({
        url: asset.url,
        width: Math.max(0, Math.trunc(Number(asset.width) || 0)),
        height: Math.max(0, Math.trunc(Number(asset.height) || 0)),
        offsetX: Math.trunc(Number(asset.offsetX) || 0),
        offsetY: Math.trunc(Number(asset.offsetY) || 0),
        usesOffsets: Number(asset.width) > 0 && Number(asset.height) > 0,
        placementX: Number.isFinite(Number(asset.placementX)) ? Number(asset.placementX) : undefined,
        placementY: Number.isFinite(Number(asset.placementY)) ? Number(asset.placementY) : undefined,
      })),
      previewTruncated: icon.previewTruncated,
    }));
  }

  private activePatchPaks(
    engine: EngineId,
    layout = this.clientResourceLayout(engine)
  ): CachedPatchPak[] {
    const resourceRoots = layout?.dataRoots || [];
    const supportedExtensions = uiEditorArchiveExtensions(engine);
    return listCachedPatchPaks(getPatchCacheRoot(this.context), resourceRoots)
      .filter(pak => isPatchCacheCurrent(pak))
      .filter(pak => supportedExtensions.includes(
        path.extname(pak.pakPath).slice(1).toLowerCase() as 'pak' | 'jpk' | 'wil' | 'wzl'
      ));
  }

  private clientResourceLayout(engine: EngineId): ClientResourceLayout | undefined {
    const patchState = this.context.workspaceState.get<SavedPatchManagerState>(
      patchManagerStateKey(engine)
    ) || this.context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
    if (patchState?.engine && patchState.engine !== engine) return undefined;
    return clientResourceLayoutFromState(patchState);
  }

  private officialNpcArchiveFiles(layout: ClientResourceLayout | undefined): string[] {
    if (!layout) return [];
    const files = new Map<string, string>();
    for (const archiveName of ['npc', 'npc2', 'npc3', 'npc4']) {
      for (const extension of ['pak', 'jpk', 'wzl', 'wil'] as const) {
        for (const dataRoot of layout.dataRoots) {
          const sourcePath = resolveResourceFile([dataRoot], [archiveName], `.${extension}`);
          if (sourcePath) files.set(path.resolve(sourcePath).toLowerCase(), sourcePath);
        }
      }
    }
    return [...files.values()];
  }

  private resolveOfficialNpcAnimation(
    appearance: number,
    engine: EngineId,
    resourceRoots: Set<string>,
    layout: ClientResourceLayout | undefined,
    archiveFiles: readonly string[],
    patchPaks: readonly CachedPatchPak[]
  ): { frames: ResolvedNpcFrame[]; interval: number; label: string } {
    const plan = resolveOfficialNpcAnimationPlan(appearance, engine);
    if (!plan) {
      return { frames: [], interval: 0, label: `官方外观 ${appearance}，未收录素材映射` };
    }
    if (!layout || layout.dataRoots.length === 0) {
      return { frames: [], interval: 0, label: `官方外观 ${appearance}，未选择客户端目录` };
    }
    const sourcePath = selectOfficialNpcArchiveFile(
      plan.archiveName,
      archiveFiles,
      layout.dataRoots,
      layout.customPatchDirectories,
      engine
    );
    if (!sourcePath) {
      return {
        frames: [],
        interval: 0,
        label: `官方外观 ${appearance}，未找到 ${plan.archiveName}.pak 或客户端 WZL/WIL`,
      };
    }

    const pak = patchPaks
      .find(candidate => sameFilePath(candidate.pakPath, sourcePath));
    const sourceLabel = path.basename(sourcePath);
    if (!pak || !isPatchCacheCurrent(pak) || !this.panel) {
      return {
        frames: [],
        interval: plan.interval,
        label: `官方外观 ${appearance} · ${sourceLabel} 未缓存`,
      };
    }

    let assetTable: CachedPatchAssetTable;
    try {
      assetTable = this.originalAssetTable(pak);
    } catch (error) {
      console.warn('[BOO] 官方 NPC 素材索引读取失败:', error instanceof Error ? error.message : String(error));
      return {
        frames: [],
        interval: plan.interval,
        label: `官方外观 ${appearance} · ${sourceLabel} 索引不可用`,
      };
    }

    const frames: ResolvedNpcFrame[] = [];
    for (let frame = 0; frame < plan.frameWindow; frame++) {
      const imageIndex = plan.startIndex + frame;
      if (imageIndex >= pak.slotCount || imageIndex >= assetTable.slotCount) break;
      if (
        !assetTable.present[imageIndex]
        || assetTable.blank[imageIndex]
        || assetTable.width[imageIndex] <= 1
        || assetTable.height[imageIndex] <= 1
      ) continue;
      const imagePath = patchImagePath(pak, imageIndex);
      if (!pak.archiveId && !isFile(imagePath)) continue;
      frames.push({
        url: this.panel.webview.asWebviewUri(
          pak.archiveId
            ? archiveResourceUri(pak.archiveId, imageIndex)
            : vscode.Uri.file(imagePath)
        ).toString(),
        width: assetTable.width[imageIndex],
        height: assetTable.height[imageIndex],
        offsetX: assetTable.offsetX[imageIndex],
        offsetY: assetTable.offsetY[imageIndex],
        usesOffsets: true,
      });
    }
    if (!pak.archiveId) resourceRoots.add(pak.cacheDir);
    const archiveLabel = officialNpcArchiveBaseName(sourcePath);
    return {
      frames,
      interval: frames.length > 1 ? plan.interval : 0,
      label: `官方外观 ${appearance} · ${archiveLabel}${path.extname(sourcePath)} · ${String(plan.startIndex).padStart(6, '0')} · ${frames.length}/${plan.frameWindow} 帧`,
    };
  }

  private resolveCustomNpcAnimation(
    envirDirectory: string,
    appearance: number,
    engine: EngineId,
    patchPaks: CachedPatchPak[],
    effectImageArchives: { name: string; willIdx: number }[],
    resourceRoots: Set<string>
  ): { frames: ResolvedNpcFrame[]; interval: number; label: string } {
    const configPath = findCustomNpcConfig(envirDirectory, appearance, engine);
    if (!configPath) {
      return { frames: [], interval: 0, label: `自定义外观 ${appearance}，未找到配置` };
    }
    const animation = parseCustomNpcAnimation(readOptionalText(configPath) || '', engine);
    if (!animation) {
      return {
        frames: [],
        interval: 0,
        label: `${path.basename(configPath)} 未找到可用的站立动作`,
      };
    }
    const selected = selectCustomNpcArchive(animation.fileIndex, effectImageArchives, patchPaks);
    const pak = selected.archive;
    const expected = selected.expectedPakName ? ` (${selected.expectedPakName}.pak)` : '';
    if (!pak || !this.panel) {
      return {
        frames: [],
        interval: animation.interval,
        label: `${path.basename(configPath)} · WIL ${animation.fileIndex}${expected} 未缓存`,
      };
    }
    let assetTable: CachedPatchAssetTable | undefined;
    try {
      assetTable = this.originalAssetTable(pak);
    } catch (error) {
      console.warn('[BOO] NPC 素材偏移读取失败:', error instanceof Error ? error.message : String(error));
    }
    const frames: ResolvedNpcFrame[] = [];
    for (let frame = 0; frame < animation.frameCount; frame++) {
      const imageIndex = animation.startIndex + frame;
      if (imageIndex >= pak.slotCount) break;
      const imagePath = patchImagePath(pak, imageIndex);
      if (!pak.archiveId && !isFile(imagePath)) continue;
      const hasMetadata = Boolean(
        assetTable
        && imageIndex < assetTable.slotCount
        && assetTable.present[imageIndex]
        && assetTable.width[imageIndex] > 0
        && assetTable.height[imageIndex] > 0
      );
      frames.push({
        url: this.panel.webview.asWebviewUri(
          pak.archiveId
            ? archiveResourceUri(pak.archiveId, imageIndex)
            : vscode.Uri.file(imagePath)
        ).toString(),
        width: hasMetadata ? assetTable!.width[imageIndex] : 0,
        height: hasMetadata ? assetTable!.height[imageIndex] : 0,
        offsetX: hasMetadata ? assetTable!.offsetX[imageIndex] : 0,
        offsetY: hasMetadata ? assetTable!.offsetY[imageIndex] : 0,
        usesOffsets: hasMetadata,
      });
    }
    if (!pak.archiveId) resourceRoots.add(pak.cacheDir);
    return {
      frames,
      interval: animation.interval,
      label: `${path.basename(configPath)} · WIL ${animation.fileIndex}${expected} · ${String(animation.startIndex).padStart(6, '0')} · ${frames.length}/${animation.frameCount} 帧`,
    };
  }

  private enqueueMarkerUpdate(message: MapPreviewMessage): void {
    this.markerSaveQueue = this.markerSaveQueue.then(() => {
      try {
        const marker = this.saveMarkerUpdate(message);
        void this.panel?.webview.postMessage({
          type: 'markerSaved',
          requestId: message.requestId,
          marker,
        });
      } catch (error) {
        void this.panel?.webview.postMessage({
          type: 'markerSaveError',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private saveMarkerUpdate(message: MapPreviewMessage): ReturnType<typeof parseMapMarkerText>[number] {
    if (!isFile(this.markerFile)) throw new Error('尚未导入小地图标识文件');
    const marker = parseMarkerUpdateMessage(message.marker);
    const decoded = decodeTextFile(fs.readFileSync(this.markerFile));
    const updated = updateMapMarkerLine(decoded.text, marker.lineNumber, marker.update);
    fs.writeFileSync(this.markerFile, encodeTextFile(updated.text, decoded.encoding));
    return updated.marker;
  }

  private enqueueMarkerAddition(message: MapPreviewMessage): void {
    this.markerSaveQueue = this.markerSaveQueue.then(() => {
      try {
        const markers = this.saveMarkerAdditions(message);
        void this.panel?.webview.postMessage({
          type: 'markersAdded',
          requestId: message.requestId,
          markers,
        });
      } catch (error) {
        void this.panel?.webview.postMessage({
          type: 'markersAddError',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private saveMarkerAdditions(message: MapPreviewMessage): ReturnType<typeof parseMapMarkerText> {
    if (!isFile(this.markerFile)) throw new Error('尚未导入小地图标识文件');
    if (!this.currentMap) throw new Error('尚未选择地图');
    const updates = parseMarkerAdditionMessage(message.marker, this.currentMap.name);
    const decoded = decodeTextFile(fs.readFileSync(this.markerFile));
    const appended = appendMapMarkerLines(decoded.text, updates);
    fs.writeFileSync(this.markerFile, encodeTextFile(appended.text, decoded.encoding));
    return appended.markers;
  }

  private async requestMarkerDeletion(message: MapPreviewMessage): Promise<void> {
    const lineNumber = Number(message.marker?.lineNumber);
    const currentMap = this.currentMap;
    const marker = this.readMarkers().find(item => item.lineNumber === lineNumber);
    if (
      !Number.isInteger(lineNumber)
      || lineNumber < 1
      || !marker
      || !currentMap
      || !markerMatchesMap(marker, currentMap)
    ) {
      void this.panel?.webview.postMessage({
        type: 'markerDeleteError',
        requestId: message.requestId,
        message: '要删除的地图标识不存在',
      });
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `确定删除地图标识“${marker.displayText}”吗？`,
      { modal: true },
      '删除'
    );
    if (confirmed !== '删除') {
      void this.panel?.webview.postMessage({
        type: 'markerDeleteCancelled',
        requestId: message.requestId,
      });
      return;
    }
    if (this.currentMap?.key !== currentMap.key) {
      void this.panel?.webview.postMessage({
        type: 'markerDeleteCancelled',
        requestId: message.requestId,
      });
      return;
    }

    this.markerSaveQueue = this.markerSaveQueue.then(() => {
      try {
        const markers = this.saveMarkerDeletion(lineNumber, currentMap);
        void this.panel?.webview.postMessage({
          type: 'markerDeleted',
          requestId: message.requestId,
          lineNumber,
          markers,
        });
      } catch (error) {
        void this.panel?.webview.postMessage({
          type: 'markerDeleteError',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private saveMarkerDeletion(
    lineNumber: number,
    map: MapInfoEntry
  ): ReturnType<typeof parseMapMarkerText> {
    if (!isFile(this.markerFile)) throw new Error('尚未导入小地图标识文件');
    const decoded = decodeTextFile(fs.readFileSync(this.markerFile));
    const deleted = deleteMapMarkerLine(decoded.text, lineNumber);
    fs.writeFileSync(this.markerFile, encodeTextFile(deleted.text, decoded.encoding));
    return parseMapMarkerText(deleted.text).filter(marker =>
      markerMatchesMap(marker, map)
    );
  }

  private enqueueNpcUpdate(message: MapPreviewMessage): void {
    const mapKey = this.currentMap?.key;
    this.entitySaveQueue = this.entitySaveQueue.then(() => {
      try {
        if (!mapKey || this.currentMap?.key !== mapKey) throw new Error('当前地图已经切换');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const envirDirectory = workspaceRoot ? findEnvirDirectory(workspaceRoot) : undefined;
        const merchantPath = envirDirectory ? path.join(envirDirectory, 'Merchant.txt') : '';
        if (!workspaceRoot || !envirDirectory || !merchantPath || !isFile(merchantPath)) {
          throw new Error('未找到 Merchant.txt');
        }
        const lineNumber = Number(message.npc?.lineNumber);
        const x = Number(message.npc?.x);
        const y = Number(message.npc?.y);
        const appearance = Number(message.npc?.appearance);
        const iconText = typeof message.npc?.iconText === 'string'
          ? message.npc.iconText
          : undefined;
        const engine = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        const decoded = decodeTextFile(fs.readFileSync(merchantPath));
        const updated = updateMerchantNpc(decoded.text, lineNumber, x, y, appearance);
        if (iconText !== undefined) validateNpcIconText(iconText, engine);
        fs.writeFileSync(merchantPath, encodeTextFile(updated.text, decoded.encoding));
        if (iconText !== undefined) {
          saveNpcIconText(envirDirectory, updated.npc, engine, iconText);
        }
        const mir200Directory = findMir200Directory(workspaceRoot);
        const setupText = mir200Directory
          ? readOptionalText(path.join(mir200Directory, '!Setup.txt'))
          : undefined;
        const context = this.createNpcResolutionContext(
          workspaceRoot,
          envirDirectory,
          engine,
          engineColor(parseMerchantNameColor(setupText || ''))
        );
        const resolvedNpc = this.resolveMapNpc(updated.npc, context);
        void this.panel?.webview.postMessage({
          type: 'npcSaved',
          requestId: message.requestId,
          npc: resolvedNpc,
        });
      } catch (error) {
        this.postEntitySaveError('npc', message, error);
      }
    });
  }

  private enqueueSpawnUpdate(message: MapPreviewMessage): void {
    const mapKey = this.currentMap?.key;
    this.entitySaveQueue = this.entitySaveQueue.then(() => {
      try {
        if (!mapKey || this.currentMap?.key !== mapKey) throw new Error('当前地图已经切换');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const envirDirectory = workspaceRoot ? findEnvirDirectory(workspaceRoot) : undefined;
        const monGenPath = envirDirectory ? path.join(envirDirectory, 'MonGen.txt') : '';
        if (!monGenPath || !isFile(monGenPath)) throw new Error('未找到 MonGen.txt');
        const lineNumber = Number(message.spawn?.lineNumber);
        const fields = Array.isArray(message.spawn?.fields)
          ? message.spawn.fields.map(value => String(value ?? ''))
          : [];
        const decoded = decodeTextFile(fs.readFileSync(monGenPath));
        const updated = updateMonGenFields(decoded.text, lineNumber, fields);
        fs.writeFileSync(monGenPath, encodeTextFile(updated.text, decoded.encoding));
        void this.panel?.webview.postMessage({
          type: 'spawnSaved',
          requestId: message.requestId,
          spawn: updated.spawn,
        });
      } catch (error) {
        this.postEntitySaveError('spawn', message, error);
      }
    });
  }

  private enqueueNpcMove(message: MapPreviewMessage): void {
    const sourceMapKey = this.currentMap?.key;
    this.entitySaveQueue = this.entitySaveQueue.then(() => {
      try {
        if (!sourceMapKey || this.currentMap?.key !== sourceMapKey) throw new Error('当前地图已经切换');
        const targetMapKey = String(message.npc?.targetMapKey || '');
        const targetMap = this.maps.find(map => map.key === targetMapKey);
        if (!targetMap) throw new Error('目标地图已经失效，请重新选择');
        if (targetMap.key === sourceMapKey) throw new Error('NPC 已经位于当前地图');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const envirDirectory = workspaceRoot ? findEnvirDirectory(workspaceRoot) : undefined;
        const merchantPath = envirDirectory ? path.join(envirDirectory, 'Merchant.txt') : '';
        if (!workspaceRoot || !envirDirectory || !merchantPath || !isFile(merchantPath)) {
          throw new Error('未找到 Merchant.txt');
        }
        const lineNumber = Number(message.npc?.lineNumber);
        let x = Number(message.npc?.x);
        let y = Number(message.npc?.y);
        const appearance = Number(message.npc?.appearance);
        const engine = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        const layout = this.clientResourceLayout(engine);
        const dimensions = findMapDimensions(
          workspaceRoot,
          [targetMap.originalMapId, targetMap.mapId],
          layout?.mapRoots || []
        );
        if (dimensions) {
          x = Math.max(0, Math.min(dimensions.width - 1, Math.round(x)));
          y = Math.max(0, Math.min(dimensions.height - 1, Math.round(y)));
        }
        const decoded = decodeTextFile(fs.readFileSync(merchantPath));
        const updated = updateMerchantNpc(
          decoded.text,
          lineNumber,
          x,
          y,
          appearance,
          targetMap.mapId
        );
        const iconText = typeof message.npc?.iconText === 'string'
          ? message.npc.iconText
          : undefined;
        if (iconText !== undefined) validateNpcIconText(iconText, engine);
        fs.writeFileSync(merchantPath, encodeTextFile(updated.text, decoded.encoding));
        if (iconText !== undefined) saveNpcIconText(envirDirectory, updated.npc, engine, iconText);
        this.pendingNpcReveal = {
          mapKey: targetMap.key,
          lineNumber: updated.npc.lineNumber,
          x: updated.npc.x,
          y: updated.npc.y,
          displayName: updated.npc.displayName,
        };
        this.openMap(targetMap, false);
      } catch (error) {
        void this.panel?.webview.postMessage({
          type: 'npcMoveError',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private postEntitySaveError(
    entityType: 'npc' | 'spawn',
    message: MapPreviewMessage,
    error: unknown
  ): void {
    void this.panel?.webview.postMessage({
      type: 'entitySaveError',
      entityType,
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private async openNpcScript(message: MapPreviewMessage): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const envirDirectory = workspaceRoot ? findEnvirDirectory(workspaceRoot) : undefined;
    const merchantPath = envirDirectory ? path.join(envirDirectory, 'Merchant.txt') : '';
    const lineNumber = Number(message.npc?.lineNumber);
    if (!envirDirectory || !merchantPath || !isFile(merchantPath) || !Number.isInteger(lineNumber)) {
      void vscode.window.showWarningMessage('无法定位当前 NPC 配置');
      return;
    }
    const currentMap = this.currentMap;
    const npc = parseMerchantText(decodeTextFile(fs.readFileSync(merchantPath)).text)
      .find(item => item.lineNumber === lineNumber);
    if (!npc || !currentMap || !mapEntityMatches(npc.mapName, currentMap)) {
      void vscode.window.showWarningMessage('当前地图中不存在这个 NPC');
      return;
    }
    const scriptPath = resolveMerchantScriptPath(envirDirectory, npc);
    if (!scriptPath) {
      void vscode.window.showWarningMessage(`未找到 NPC 脚本：${npc.scriptRef}`);
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(scriptPath));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
      preview: false,
    });
  }

  private resolveMiniMapImage(
    reference: MiniMapReference
  ): ReturnType<typeof findCachedPatchImage> {
    const patchCacheRoot = getPatchCacheRoot(this.context);
    const definition = getEngineDefinition(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    const resourceRoots = this.clientResourceLayout(definition.id)?.dataRoots || [];
    for (const archiveName of miniMapArchiveCandidates(reference.pakName)) {
      const cached = findCachedPatchImage(
        patchCacheRoot,
        archiveName,
        reference.imageIndex,
        resourceRoots,
        uiEditorArchiveExtensions(definition.id)
      );
      if (cached) return cached;
    }
    return undefined;
  }

  private clearOriginalMapSession(): void {
    this.originalMapVersion++;
    this.originalMapSession = undefined;
    this.originalAssetTables.clear();
  }

  private postOriginalProgress(requestId: number, percent: number, label: string): void {
    void this.panel?.webview.postMessage({
      type: 'originalMapProgress',
      requestId,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      label,
    });
  }

  private postOriginalMapReady(requestId: number, session: OriginalMapSession): void {
    void this.panel?.webview.postMessage({
      type: 'originalMapReady',
      requestId,
      mapKey: session.mapKey,
      fileName: path.basename(session.filePath),
      format: session.model.format,
      width: session.model.width,
      height: session.model.height,
      pixelWidth: session.model.width * 48,
      pixelHeight: session.model.height * 32,
      archiveCount: session.model.archiveNames.length,
      referenceCount: session.model.referenceCount,
    });
  }

  private async loadOriginalMap(message: MapPreviewMessage): Promise<void> {
    const requestId = Number(message.requestId) || 0;
    const map = this.currentMap;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!map || !workspaceRoot || !this.panel) return;
    const version = ++this.originalMapVersion;
    try {
      let session = this.originalMapSession?.mapKey === map.key
        ? this.originalMapSession
        : undefined;
      if (!session) {
        this.postOriginalProgress(requestId, 3, '正在定位原始 MAP');
        const engine = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        const mapPath = findMapPath(
          workspaceRoot,
          [map.originalMapId, map.mapId],
          this.clientResourceLayout(engine)?.mapRoots || []
        );
        if (!mapPath) throw new Error(`未找到 ${map.originalMapId} 或 ${map.mapId}.map`);
        this.postOriginalProgress(requestId, 8, `正在读取 ${path.basename(mapPath)}`);
        const fileData = await fs.promises.readFile(mapPath);
        if (version !== this.originalMapVersion || this.currentMap?.key !== map.key) return;
        const model = await parseOriginalMap(fileData, (completed, total) => {
          if (version !== this.originalMapVersion) return;
          this.postOriginalProgress(
            requestId,
            10 + (completed / Math.max(1, total)) * 35,
            `正在解析地图单元 ${completed}/${total}`
          );
        });
        if (version !== this.originalMapVersion || this.currentMap?.key !== map.key) return;
        session = { mapKey: map.key, filePath: mapPath, model };
        this.originalMapSession = session;
      } else {
        this.postOriginalProgress(requestId, 45, '原始地图结构已缓存');
      }
      this.postOriginalMapReady(requestId, session);
      if (!session.data) {
        session.data = await this.resolveOriginalMapData(session, requestId, version);
      }
      if (version !== this.originalMapVersion || this.currentMap?.key !== map.key) return;
      this.postOriginalProgress(requestId, 80, '完整地图素材已准备，正在传送到预览界面');
      await this.panel.webview.postMessage({
        type: 'originalMapData',
        requestId,
        ...session.data,
      });
    } catch (error) {
      if (version !== this.originalMapVersion) return;
      void this.panel?.webview.postMessage({
        type: 'originalMapError',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async resolveOriginalMapData(
    session: OriginalMapSession,
    requestId: number,
    version: number
  ): Promise<OriginalMapData> {
    const map = this.currentMap;
    if (!this.panel || !map || session.mapKey !== map.key) throw new Error('原始地图会话已失效');
    this.postOriginalProgress(requestId, 47, '正在整理完整地图素材引用');
    const references = collectOriginalMapViewport(session.model, {
      left: 0,
      top: 0,
      right: session.model.width - 1,
      bottom: session.model.height - 1,
    });
    const uniqueReferences = new Map<string, OriginalMapDrawReference>();
    for (const reference of references) {
      if (!uniqueReferences.has(reference.resourceKey)) {
        uniqueReferences.set(reference.resourceKey, reference);
      }
    }
    const referencesByArchive = new Map<string, OriginalMapDrawReference[]>();
    for (const reference of uniqueReferences.values()) {
      const list = referencesByArchive.get(reference.archiveName) || [];
      list.push(reference);
      referencesByArchive.set(reference.archiveName, list);
    }

    const definition = getEngineDefinition(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    const resourceRoots = this.clientResourceLayout(definition.id)?.dataRoots || [];
    const supportedExtensions = uiEditorArchiveExtensions(definition.id);
    let archiveFiles: string[] = [];
    let sourceScanWarning = '';
    if (resourceRoots.length > 0) {
      this.postOriginalProgress(requestId, 48, '正在核对客户端地图素材');
      try {
        archiveFiles = await scanClientArchiveFiles(resourceRoots, supportedExtensions);
      } catch (error) {
        sourceScanWarning = error instanceof Error ? error.message : String(error);
      }
    }

    const resources: ResolvedOriginalResource[] = [];
    const resourceIds = new Map<string, number>();
    const missingSourceArchives = new Set<string>();
    const unindexedArchives = new Set<string>();
    const staleArchives = new Set<string>();
    const sharedCacheArchives = new Set<string>();
    let missingImages = 0;
    let archiveNumber = 0;
    let resolvedReferenceNumber = 0;
    for (const [archiveName, archiveReferences] of referencesByArchive) {
      if (version !== this.originalMapVersion || this.currentMap?.key !== map.key) {
        throw new Error('原始地图加载已取消');
      }
      const resolution = this.resolveOriginalArchive(
        archiveName,
        archiveFiles,
        resourceRoots,
        supportedExtensions,
        !sourceScanWarning
      );
      if (resolution.status === 'missing-source') {
        missingSourceArchives.add(archiveName);
      } else if (resolution.status === 'not-indexed') {
        unindexedArchives.add(path.basename(resolution.sourcePath));
      } else if (resolution.status === 'stale') {
        staleArchives.add(path.basename(resolution.sourcePath));
      } else {
        if (resolution.status === 'shared-cache') sharedCacheArchives.add(archiveName);
        const pak = resolution.pak;
        const table = this.originalAssetTable(pak);
        for (const reference of archiveReferences) {
          const index = reference.imageIndex;
          if (
            index < 0
            || index >= table.slotCount
            || !table.present[index]
            || table.blank[index]
          ) {
            if (index >= table.slotCount || !table.present[index]) missingImages++;
          } else {
            const imagePath = patchImagePath(pak, index);
            if (!pak.archiveId && !fs.existsSync(imagePath)) {
              missingImages++;
            } else {
              const resourceId = resources.length;
              resourceIds.set(reference.resourceKey, resourceId);
              resources.push({
                key: reference.resourceKey,
                url: this.panel.webview.asWebviewUri(
                  pak.archiveId
                    ? archiveResourceUri(pak.archiveId, index)
                    : vscode.Uri.file(imagePath)
                ).toString(),
                width: table.width[index] || 1,
                height: table.height[index] || 1,
                offsetX: table.offsetX[index] || 0,
                offsetY: table.offsetY[index] || 0,
              });
            }
          }
          resolvedReferenceNumber++;
          if (resolvedReferenceNumber % 2000 === 0) {
            await new Promise<void>(resolve => setImmediate(resolve));
          }
        }
      }
      archiveNumber++;
      this.postOriginalProgress(
        requestId,
        50 + (archiveNumber / Math.max(1, referencesByArchive.size)) * 27,
        `正在读取完整素材包 ${archiveNumber}/${referencesByArchive.size}`
      );
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    const tiles: number[] = [];
    const smTiles: number[] = [];
    const objects: number[] = [];
    for (let index = 0; index < references.length; index++) {
      const reference = references[index];
      const resourceId = resourceIds.get(reference.resourceKey);
      if (resourceId !== undefined) {
        const target = reference.layer === 'tile'
          ? tiles
          : reference.layer === 'smTile'
            ? smTiles
            : objects;
        target.push(reference.x, reference.y, resourceId);
      }
      if (index > 0 && index % 10000 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
    const warnings: string[] = [];
    if (resourceRoots.length === 0) {
      warnings.push('未绑定客户端资源目录');
    } else if (sourceScanWarning) {
      warnings.push(`客户端素材目录读取失败：${sourceScanWarning}`);
    }
    if (missingSourceArchives.size && resourceRoots.length > 0) {
      warnings.push(`客户端缺少 ${formatArchiveNames(missingSourceArchives)}`);
    }
    if (unindexedArchives.size) {
      warnings.push(`尚未读取 ${formatArchiveNames(unindexedArchives)}`);
    }
    if (staleArchives.size) {
      warnings.push(`缓存已失效 ${formatArchiveNames(staleArchives)}`);
    }
    if (sharedCacheArchives.size) {
      warnings.push(`复用共享官方缓存 ${formatArchiveNames(sharedCacheArchives)}`);
    }
    if (missingImages) warnings.push(`${missingImages} 个图片序号缺失`);
    return {
      resources,
      tiles,
      smTiles,
      objects,
      warning: warnings.join('；'),
    };
  }

  private resolveOriginalArchive(
    archiveName: string,
    archiveFiles: readonly string[],
    resourceRoots: readonly string[],
    supportedExtensions: readonly ArchiveExtension[],
    allowSharedCache: boolean
  ): OriginalArchiveResolution {
    const cacheRoot = getPatchCacheRoot(this.context);
    const exact = resolveCachedPatchArchiveByName(
      cacheRoot,
      archiveName,
      archiveFiles,
      resourceRoots,
      supportedExtensions
    );
    if (
      exact.status !== 'missing-source'
      || !allowSharedCache
      || resourceRoots.length === 0
      || !/^(?:tiles|smtiles|objects)\d*$/i.test(archiveName)
    ) {
      return exact;
    }
    const classicExtensions = supportedExtensions.filter(
      (extension): extension is 'wil' | 'wzl' => extension === 'wil' || extension === 'wzl'
    );
    if (classicExtensions.length === 0) return exact;
    const shared = findUniqueCurrentCachedPatchPakByName(
      cacheRoot,
      archiveName,
      classicExtensions
    );
    return shared
      ? { status: 'shared-cache', sourcePath: shared.pakPath, pak: shared }
      : exact;
  }

  private originalAssetTable(pak: CachedPatchPak): CachedPatchAssetTable {
    const key = path.normalize(pak.manifestPath).toLowerCase();
    const cached = this.originalAssetTables.get(key);
    if (cached) {
      this.originalAssetTables.delete(key);
      this.originalAssetTables.set(key, cached);
      return cached;
    }
    const table = loadCachedPatchAssetTable(pak);
    this.originalAssetTables.set(key, table);
    while (this.originalAssetTables.size > 8) {
      const oldest = this.originalAssetTables.keys().next().value as string | undefined;
      if (!oldest) break;
      this.originalAssetTables.delete(oldest);
    }
    return table;
  }

  private sidebarHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:12px "Microsoft YaHei",sans-serif;overflow:hidden}
.root{height:100vh;display:flex;flex-direction:column}
.import{margin:8px 8px 6px;width:calc(100% - 16px);min-height:32px;border:0;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;font-weight:600}
.import:hover{background:var(--vscode-button-hoverBackground)}
.file{padding:0 9px 6px;color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file.missing{color:var(--vscode-errorForeground,#f48771)}
.tools{display:grid;grid-template-columns:1fr 28px;gap:5px;padding:0 8px 7px;border-bottom:1px solid var(--vscode-sideBar-border,#333)}
input{width:100%;height:28px;border:1px solid var(--vscode-input-border,#555);background:var(--vscode-input-background);color:var(--vscode-input-foreground);padding:0 7px;outline:none}
input:focus{border-color:var(--vscode-focusBorder)}
.refresh{width:28px;height:28px;border:0;background:transparent;color:var(--vscode-foreground);cursor:pointer;font-size:16px}
.refresh:hover{background:var(--vscode-toolbar-hoverBackground)}
.list{flex:1;overflow:auto}
.item{height:30px;display:flex;align-items:center;padding:0 9px;border-bottom:1px solid rgba(127,127,127,.12);cursor:pointer;white-space:nowrap}
.item:hover{background:var(--vscode-list-hoverBackground)}
.item.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.name{overflow:hidden;text-overflow:ellipsis}
.empty{padding:14px 10px;color:var(--vscode-descriptionForeground);line-height:1.6}
.count{padding:5px 9px;color:var(--vscode-descriptionForeground);font-size:10px;border-top:1px solid var(--vscode-sideBar-border,#333)}
</style></head><body><div class="root">
<button class="import" id="import">导入小地图标识.txt</button>
<div class="file" id="file">尚未导入标识文件</div>
<div class="tools"><input id="search" placeholder="搜索地图名字"><button class="refresh" id="refresh" title="重新读取">↻</button></div>
<div class="list" id="list"></div><div class="count" id="count"></div>
</div><script>
const vscode=acquireVsCodeApi();let state={maps:[],activeKey:'',query:'',engineSupported:true};
const list=document.getElementById('list'),count=document.getElementById('count');
function render(){
  const q=state.query.trim().toLowerCase();
  const maps=state.maps.filter(m=>!q||m.name.toLowerCase().includes(q)||m.mapId.toLowerCase().includes(q)||m.originalMapId.toLowerCase().includes(q));
  list.textContent='';
  if(!maps.length){const e=document.createElement('div');e.className='empty';e.textContent=!state.engineSupported?'当前引擎的地图资源规则尚未通过验证':state.maps.length?'没有匹配的地图':'未找到 MapInfo.txt 地图配置';list.appendChild(e)}
  for(const map of maps){const row=document.createElement('div');row.className='item'+(map.key===state.activeKey?' active':'');row.title=map.mapId+' | '+map.originalMapId;row.dataset.key=map.key;const name=document.createElement('span');name.className='name';name.textContent=map.name;row.appendChild(name);list.appendChild(row)}
  count.textContent='地图 '+maps.length+(maps.length!==state.maps.length?' / '+state.maps.length:'');
}
document.getElementById('import').addEventListener('click',()=>vscode.postMessage({type:'importMarkers'}));
document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
document.getElementById('search').addEventListener('input',e=>{state.query=e.target.value;render()});
list.addEventListener('click',e=>{const row=e.target.closest('.item');if(row)vscode.postMessage({type:'openMap',key:row.dataset.key})});
window.addEventListener('message',e=>{if(e.data.type!=='state')return;state.maps=e.data.maps||[];state.activeKey=e.data.activeKey||'';state.engineSupported=e.data.engineSupported!==false;const file=document.getElementById('file');file.textContent=e.data.markerFile?(e.data.markerFileMissing?'文件不存在：':'已载入：')+e.data.markerFile:'尚未导入标识文件';file.title=e.data.markerFilePath||'';file.classList.toggle('missing',!!e.data.markerFileMissing);render()});
vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}

function formatArchiveNames(values: Iterable<string>, maximum = 8): string {
  const names = [...values];
  const visible = names.slice(0, maximum).join('、');
  return names.length > maximum ? `${visible} 等 ${names.length} 个` : visible;
}

function findEnvirFile(workspaceRoot: string, fileName: string): string | undefined {
  const envirDirectory = findEnvirDirectory(workspaceRoot);
  if (!envirDirectory) return undefined;
  const candidate = path.join(envirDirectory, fileName);
  return isFile(candidate) ? candidate : undefined;
}

function findMapDimensions(
  workspaceRoot: string,
  mapNames: string[],
  clientMapRoots: readonly string[] = []
): MapDimensions | undefined {
  const mapPath = findMapPath(workspaceRoot, mapNames, clientMapRoots);
  return mapPath ? readClassicMapDimensions(mapPath) : undefined;
}

function findMapPath(
  workspaceRoot: string,
  mapNames: string[],
  clientMapRoots: readonly string[] = []
): string | undefined {
  const mir200Directory = findMir200Directory(workspaceRoot);
  const mapRoots = [
    ...clientMapRoots,
    mir200Directory ? path.join(mir200Directory, 'Map') : '',
    path.join(workspaceRoot, 'Map'),
  ].filter(Boolean);
  return resolveResourceFile(mapRoots, mapNames, '.map');
}

function isFile(filePath: string): boolean {
  try { return Boolean(filePath) && fs.statSync(filePath).isFile(); } catch { return false; }
}

function sameFilePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function readOptionalText(filePath: string): string | undefined {
  if (!isFile(filePath)) return undefined;
  try {
    return decodeTextFile(fs.readFileSync(filePath)).text;
  } catch (error) {
    console.warn('[BOO] 地图实体文件读取失败:', filePath, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function parseMarkerUpdateMessage(value: MapPreviewMessage['marker']): {
  lineNumber: number;
  update: MapMarkerUpdate;
} {
  if (!value || typeof value !== 'object') throw new Error('标识数据无效');
  const lineNumber = Number(value.lineNumber);
  const x = Number(value.x);
  const y = Number(value.y);
  const mode = Number(value.mode);
  const mapName = typeof value.mapName === 'string' ? value.mapName : '';
  const text = typeof value.text === 'string' ? value.text : '';
  const colorSource = typeof value.colorSource === 'string' ? value.colorSource : '';
  if (!Number.isInteger(lineNumber) || lineNumber < 1) throw new Error('标识行号无效');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error('标识坐标必须是大于等于 0 的整数');
  }
  if (mode !== 0 && mode !== 1) throw new Error('标识所在无效');
  return {
    lineNumber,
    update: {
      mapName,
      x,
      y,
      text,
      colorSource,
      mode,
    },
  };
}

function parseMarkerAdditionMessage(
  value: MapPreviewMessage['marker'],
  currentMapName: string
): MapMarkerUpdate[] {
  if (!value || typeof value !== 'object') throw new Error('新增标识数据无效');
  const x = Number(value.x);
  const y = Number(value.y);
  const text = typeof value.text === 'string' ? value.text : '';
  const colorSource = typeof value.colorSource === 'string' ? value.colorSource : '';
  const modes = Array.isArray(value.modes)
    ? [...new Set(value.modes.map(Number))].filter(mode => mode === 0 || mode === 1)
    : [];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error('标识坐标必须是大于等于 0 的整数');
  }
  if (!modes.length) throw new Error('请至少勾选大地图或小地图');
  return modes.map(mode => ({
    mapName: currentMapName,
    x,
    y,
    text,
    colorSource,
    mode: mode as 0 | 1,
  }));
}
