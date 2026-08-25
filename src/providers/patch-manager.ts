import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureGmBridge } from '../utils/gm-bridge';
import {
  classifyPakPasswordError,
  isConfirmedPakPasswordError,
  patchPasswordSecretKey,
  readPakPasswordRecords,
  resolvePakPasswordFromRecords,
  selectPakPassword,
} from '../utils/pak-password';
import { decodePakFully } from '../utils/pak-reader';
import { openArchiveIndexed } from '../utils/archive-index';
import { clearPakCache, loadPakIndex, matchPakFile } from '../utils/pak';
import {
  filterRequiredPatchPakFiles,
  findMissingEffectImageArchives,
  findCachedPatchPakByPath,
  invalidatePatchCacheIndex,
  isPatchCacheCurrent,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  PatchCacheMd5Validation,
  PatchEntry,
  PatchReadScope,
  SavedPatchManagerState,
  validatePatchCacheMd5,
} from '../utils/patch-cache';
import { getArchiveIndexRoot, getPatchCacheRoot } from '../utils/cache-storage';
import { secureWebviewHtml } from '../utils/webview-security';
import {
  normalizeEngineId,
} from '../utils/engine-registry';
import {
  findWorkspacePatchPasswordFile,
} from '../utils/patch-discovery';
import { EngineId } from '../types';
import {
  clientResourceLayoutFromState,
  ClientResourceLayout,
  discoverClientResourceLayout,
  isUsableClientResourceLayout,
  relativeClientResourcePath,
  scanClientArchiveFiles,
} from '../utils/client-resources';
import { isPairedArchiveExtension } from '../utils/archive-types';
import { uiEditorArchiveExtensions, uiEditorArchiveLabel } from '../utils/ui-archive';

interface PatchManagerMessage {
  type?: string;
  path?: string;
  value?: string;
}

type PatchReadValidation =
  | PatchCacheMd5Validation
  | { current: false; reason: 'missing' };

export class PatchManagerProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private clientDirectory = '';
  private customPatchName = '';
  private passwordFile = '';
  private entries: PatchEntry[] = [];
  private readScope: PatchReadScope = 'required';
  private busy = false;
  private autoStarted = false;
  private autoPromise: Promise<void> | undefined;
  private engine: EngineId;
  private pendingEngine: EngineId | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.engine = normalizeEngineId(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    this.restoreState(this.engine);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('boo.engine')) return;
        const nextEngine = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        if (nextEngine === this.engine) return;
        void this.switchEngine(nextEngine);
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message as PatchManagerMessage);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });
  }

  private async handleMessage(message: PatchManagerMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        void this.autoLoadOrCache();
        return;
      case 'selectDataDirectory':
      case 'selectClientDirectory':
        await this.selectClientDirectory();
        return;
      case 'selectPasswordFile':
        await this.selectPasswordFile();
        return;
      case 'setCustomPatchName':
        await this.setCustomPatchName(message.value || '');
        return;
      case 'readRequiredPatches':
        await this.readPatches(false, 'required');
        return;
      case 'readAllPatches':
      case 'readPatches':
        await this.readPatches(false, 'all');
        return;
      case 'reloadPak':
        if (message.path) await this.reloadPak(message.path);
        return;
      case 'changePassword':
        if (message.path) await this.changePassword(message.path);
        return;
    }
  }

  public autoLoadOrCache(): Promise<void> {
    if (this.autoStarted) return this.autoPromise || Promise.resolve();
    this.autoStarted = true;
    this.autoPromise = this.runAutoLoadOrCache().finally(() => {
      this.autoPromise = undefined;
    });
    return this.autoPromise;
  }

  private async runAutoLoadOrCache(): Promise<void> {
    const layout = this.clientLayout();
    if (!layout || !isUsableClientResourceLayout(layout)) return;
    if (this.customPatchSelectionError(layout)) return;
    let changed = false;
    if (!isFile(this.passwordFile)) {
      const detectedPassword = this.detectWorkspacePasswordFile(this.clientDirectory);
      if (detectedPassword) {
        this.passwordFile = detectedPassword;
        changed = true;
      }
    }
    if (changed) {
      await this.saveState();
      this.postState();
    }
    await this.readPatches(true, 'required');
  }

  private async selectClientDirectory(): Promise<void> {
    if (this.busy) return;
    const selectionEngine = this.engine;
    const defaultUri = this.existingDirectoryUri(this.clientDirectory);
    const selected = await vscode.window.showOpenDialog({
      title: '选择传奇客户端目录',
      openLabel: '选择客户端目录',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
    });
    if (!selected?.[0] || this.engine !== selectionEngine) return;
    const nextDirectory = path.resolve(selected[0].fsPath);
    const nextLayout = discoverClientResourceLayout(nextDirectory);
    if (!isUsableClientResourceLayout(nextLayout)) {
      vscode.window.showWarningMessage('所选目录未找到客户端 data 资源目录，请选择客户端根目录');
      return;
    }
    if (normalizePath(nextDirectory) !== normalizePath(this.clientDirectory)) {
      this.entries = [];
      this.readScope = 'required';
      this.passwordFile = '';
      this.customPatchName = '';
    }
    this.clientDirectory = nextDirectory;
    if (nextLayout.availableCustomPatchDirectories.length === 1) {
      this.customPatchName = path.basename(nextLayout.availableCustomPatchDirectories[0]);
    }
    const nearbyPakTxt = this.detectWorkspacePasswordFile(nextDirectory);
    if (nearbyPakTxt) this.passwordFile = nearbyPakTxt;
    await this.saveState();
    this.postState();
    const selectedLayout = this.clientLayout();
    if (selectedLayout && this.customPatchSelectionError(selectedLayout)) {
      vscode.window.showInformationMessage('检测到多个自定义补丁目录，请先输入当前工作区使用的自定义补丁文件夹名');
      return;
    }
    await this.readPatches(false, 'required');
  }

  private async setCustomPatchName(value: string): Promise<void> {
    if (this.busy || !this.clientDirectory) return;
    const customPatchName = value.trim();
    if (customPatchName && (/[\\/]/.test(customPatchName) || customPatchName === '.' || customPatchName === '..')) {
      vscode.window.showWarningMessage('请输入客户端根目录下的自定义补丁文件夹名，不要输入完整路径');
      this.postState();
      return;
    }
    if (customPatchName === this.customPatchName) return;
    this.customPatchName = customPatchName;
    this.entries = [];
    this.readScope = 'required';
    await this.saveState();
    this.postState();
    const layout = this.clientLayout();
    const selectionError = layout ? this.customPatchSelectionError(layout) : '客户端目录无效';
    if (selectionError) {
      vscode.window.showWarningMessage(selectionError);
      return;
    }
    await this.readPatches(false, 'required');
  }

  private async selectPasswordFile(): Promise<void> {
    if (this.busy) return;
    const selectionEngine = this.engine;
    const defaultUri = this.existingDirectoryUri(
      this.passwordFile ? path.dirname(this.passwordFile) : this.clientDirectory
    );
    const selected = await vscode.window.showOpenDialog({
      title: '选择补丁资源密码文件',
      openLabel: '选择密码文件',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { '补丁资源密码文件': ['txt'] },
      defaultUri,
    });
    if (!selected?.[0] || this.engine !== selectionEngine) return;
    this.passwordFile = path.resolve(selected[0].fsPath);
    this.entries = this.entries.map(entry => ({
      ...entry,
      status: 'waiting',
      message: '等待读取',
      progress: 0,
    }));
    await this.saveState();
    this.postState();
    if (this.clientLayout()) await this.readPatches(false, this.readScope);
  }

  private async readPatches(
    automatic: boolean,
    scope: PatchReadScope
  ): Promise<void> {
    if (this.busy) return;
    if (!this.validateSelections(!automatic)) return;
    this.readScope = scope;

    this.busy = true;
    this.postState();
    let pakPaths: string[];
    const layout = this.clientLayout();
    if (!layout) {
      await this.finishOperation();
      return;
    }
    const patchCacheRoot = getPatchCacheRoot(this.context);
    try {
      const engineArchivePaths = await scanClientArchiveFiles(
        layout.dataRoots,
        uiEditorArchiveExtensions(this.engine)
      );
      const effectImageNames = this.readEffectImageArchiveNames();
      const requiredPakPaths = filterRequiredPatchPakFiles(engineArchivePaths, effectImageNames);
      pakPaths = scope === 'required'
        ? requiredPakPaths
        : engineArchivePaths;
      if (scope === 'required') {
        const missing = findMissingEffectImageArchives(engineArchivePaths, effectImageNames);
        if (missing.length > 0) {
          const message = `EffectImageList.txt 已调用但补丁目录缺少 ${missing.length} 个 ${this.archiveLabel()}: ${missing.join('、')}`;
          console.warn(`[BOO] ${message}`);
          if (!automatic) vscode.window.showWarningMessage(message);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`补丁目录读取失败: ${errorText(error)}`);
      await this.finishOperation();
      return;
    }
    if (pakPaths.length === 0) {
      this.entries = [];
      vscode.window.showWarningMessage(
        scope === 'required'
          ? '需求范围内没有找到当前引擎支持的资源包'
          : '所选客户端 Data 目录内没有当前引擎支持的资源包'
      );
      await this.finishOperation();
      return;
    }

    const validations: PatchReadValidation[] = [];
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: automatic
          ? `BOO 正在检查${scope === 'all' ? '所有' : '需求'} ${this.archiveLabel()} 资源状态`
          : `BOO 正在校验 ${this.archiveLabel()} 资源 MD5`,
        cancellable: false,
      }, async progress => {
        const nextEntries: PatchEntry[] = [];
        for (let index = 0; index < pakPaths.length; index++) {
          const pakPath = pakPaths[index];
          progress.report({
            message: `${path.basename(pakPath)} (${index + 1}/${pakPaths.length})`,
          });
          const cached = findCachedPatchPakByPath(
            patchCacheRoot,
            pakPath,
            layout.dataRoots,
            this.storageModeForPath(pakPath)
          );
          const cacheMatchesMode = cached?.storageMode === this.storageModeForPath(pakPath);
          const validation: PatchReadValidation = cached
            && cacheMatchesMode
            ? automatic && isPatchCacheCurrent(cached)
              ? { current: true, reason: 'match', sourceMd5: cached.sourceMd5 || '' }
              : await validatePatchCacheMd5(cached)
            : { current: false, reason: 'missing' };
          validations.push(validation);
          nextEntries.push({
            path: pakPath,
            name: relativeClientResourcePath(layout, pakPath),
            status: validation.current ? 'cached' : 'waiting',
            message: patchValidationMessage(validation, cached?.slotCount, this.archiveLabel()),
            progress: validation.current ? 100 : 0,
            passwordRequired: !isPairedArchiveExtension(
              path.extname(pakPath).slice(1).toLowerCase()
            ),
          });
        }
        this.entries = nextEntries;
      });
      const pending = this.entries
        .map((entry, index) => {
          const validation = validations[index];
          return {
            entry,
            index,
            forceRefresh: validation.reason !== 'match' && validation.reason !== 'missing',
          };
        })
        .filter(item => item.entry.status !== 'cached');
      await this.saveState();
      this.postState();
      if (pending.length === 0) {
        vscode.window.setStatusBarMessage(
          `MD5 校验完成，已加载 ${this.entries.length} 个补丁 ${this.archiveLabel()} 资源`,
          5000
        );
        return;
      }

      const passwordRecords = this.readPasswordRecords();
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: automatic
          ? `BOO 正在自动补齐${scope === 'all' ? '所有' : '需求'} ${this.archiveLabel()} 资源`
          : scope === 'required'
            ? `BOO 正在读取需求 ${this.archiveLabel()}`
            : `BOO 正在读取所有 ${this.archiveLabel()}`,
        cancellable: false,
      }, async progress => {
        for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex++) {
          const { entry, index, forceRefresh } = pending[pendingIndex];
          progress.report({ message: `${entry.name} (${pendingIndex + 1}/${pending.length})` });
          await this.cacheEntry(entry, index, forceRefresh, passwordRecords);
        }
      });
      const cachedCount = this.entries.filter(entry => entry.status === 'cached').length;
      const failedCount = this.entries.length - cachedCount;
      if (failedCount > 0) {
        vscode.window.showWarningMessage(`补丁读取完成: 成功 ${cachedCount} 个，失败 ${failedCount} 个`);
      } else {
        vscode.window.showInformationMessage(`补丁读取完成，共 ${cachedCount} 个 ${this.archiveLabel()}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`补丁读取失败: ${errorText(error)}`);
    } finally {
      await this.finishOperation();
    }
  }

  private async reloadPak(pakPath: string): Promise<void> {
    if (this.busy || !this.validateSelections()) return;
    const index = this.findEntryIndex(pakPath);
    if (index < 0) return;
    this.busy = true;
    clearPakCache();
    this.postState();
    try {
      const records = this.readPasswordRecords();
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在重载 ${this.entries[index].name}`,
        cancellable: false,
      }, async () => {
        await this.cacheEntry(this.entries[index], index, true, records);
      });
    } catch (error) {
      this.setEntryError(this.entries[index], error);
    } finally {
      await this.finishOperation();
    }
  }

  private async changePassword(pakPath: string): Promise<void> {
    if (this.busy || !this.validateSelections()) return;
    const selectionEngine = this.engine;
    const index = this.findEntryIndex(pakPath);
    if (index < 0) return;
    if (!this.entries[index].passwordRequired) return;
    const password = await vscode.window.showInputBox({
      title: `${this.archiveLabel()} 密码: ${this.entries[index].name}`,
      prompt: `新密码会保存到 VS Code 安全存储，并立即重新读取此 ${this.archiveLabel()}`,
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.length > 0 ? undefined : `请输入 ${this.archiveLabel()} 密码`,
    });
    if (password === undefined || this.engine !== selectionEngine) return;

    const secretKey = patchPasswordSecretKey(this.entries[index].path);
    await this.context.secrets.store(secretKey, password);
    this.busy = true;
    clearPakCache();
    this.postState();
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在重载 ${this.entries[index].name}`,
        cancellable: false,
      }, async () => {
        await this.cacheEntry(this.entries[index], index, true, [], password);
      });
      if (this.entries[index].status === 'password-error') await this.context.secrets.delete(secretKey);
    } finally {
      await this.finishOperation();
    }
  }

  private async cacheEntry(
    entry: PatchEntry,
    fallbackWillIdx: number,
    forceRefresh: boolean,
    records: ReturnType<typeof readPakPasswordRecords>,
    suppliedPassword?: string
  ): Promise<void> {
    entry.status = 'caching';
    entry.message = forceRefresh ? '正在重新读取' : '正在读取';
    entry.progress = 0;
    this.postEntry(entry);

    const extension = path.extname(entry.path).slice(1).toLowerCase();
    const pairedArchive = isPairedArchiveExtension(extension);
    const secretKey = patchPasswordSecretKey(entry.path);
    const configuredPassword = pairedArchive
      ? undefined
      : resolvePakPasswordFromRecords(records, entry.path, this.passwordDataRoot(entry.path));
    const savedPassword = pairedArchive ? undefined : await this.context.secrets.get(secretKey);
    const password = pairedArchive
      ? ''
      : selectPakPassword(suppliedPassword, configuredPassword, savedPassword);
    if (!pairedArchive && !password) {
      entry.status = 'password-error';
      entry.message = '未找到可用密码';
      entry.progress = 0;
      this.postEntry(entry);
      return;
    }
    const effectivePassword = password || '';

    try {
      const willIdx = this.resolveWillIndex(entry.path, fallbackWillIdx);
      const onProgress = (completed: number, total: number, label: string) => {
        entry.status = 'caching';
        entry.message = label;
        entry.progress = total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0;
        this.postEntry(entry);
      };
      let result;
      if (this.storageModeForPath(entry.path) === 'direct') {
        try {
          result = await openArchiveIndexed({
            extensionPath: this.context.extensionPath,
            indexRoot: getArchiveIndexRoot(this.context),
            pakPath: entry.path,
            password: effectivePassword,
            willIdx,
            ensureBridge: () => ensureGmBridge(this.context),
            forceRefresh,
            onProgress,
          });
        } catch (error) {
          if (pairedArchive) throw error;
          if (isConfirmedPakPasswordError(error)) throw error;
          console.warn(
            `[BOO] ${entry.name} 高速读取失败，自动回退 V4.2.4 兼容模式:`,
            errorText(error)
          );
          entry.message = '高速读取失败，正在改用兼容模式';
          this.postEntry(entry);
        }
      }
      if (!result) {
        result = await decodePakFully({
          extensionPath: this.context.extensionPath,
          cacheRoot: getPatchCacheRoot(this.context),
          pakPath: entry.path,
          password: effectivePassword,
          willIdx,
          ensureBridge: () => ensureGmBridge(this.context),
          forceRefresh,
          onProgress,
        });
      }
      const compatibilityNotes: string[] = [];
      if (result.recoveredChecksumCount) {
        compatibilityNotes.push(`兼容修复 ${result.recoveredChecksumCount} 张校验异常图片`);
      }
      if (result.skippedMalformedCount) {
        compatibilityNotes.push(`跳过 ${result.skippedMalformedCount} 张无法解码的异常素材，序号已保留`);
      }
      const compatibilityNote = compatibilityNotes.length > 0
        ? `，${compatibilityNotes.join('，')}`
        : '';
      entry.status = 'cached';
      entry.message = result.fromCache
        ? `资源已就绪，共 ${result.slotCount} 项${compatibilityNote}`
        : result.storageMode === 'direct'
          ? `索引完成，共 ${result.slotCount} 项${compatibilityNote}`
          : `兼容缓存完成，共 ${result.slotCount} 项${compatibilityNote}`;
      entry.progress = 100;
      if (
        configuredPassword
        && suppliedPassword === undefined
        && savedPassword
        && savedPassword !== configuredPassword
      ) {
        await this.context.secrets.delete(secretKey);
      }
      invalidatePatchCacheIndex();
    } catch (error) {
      this.setEntryError(entry, error);
    }
    this.postEntry(entry);
  }

  private setEntryError(entry: PatchEntry, error: unknown): void {
    const passwordErrorKind = classifyPakPasswordError(error);
    entry.status = passwordErrorKind === 'confirmed' ? 'password-error' : 'error';
    entry.message = passwordErrorKind === 'confirmed'
      ? '密码错误'
      : passwordErrorKind === 'ambiguous'
        ? `资源校验失败，无法确认是否为密码问题：${truncate(errorText(error), 120)}`
        : truncate(errorText(error), 180);
    entry.progress = 0;
    this.postEntry(entry);
  }

  private validateSelections(showMessage = true): boolean {
    const layout = this.clientLayout();
    if (!layout || !isUsableClientResourceLayout(layout)) {
      if (showMessage) vscode.window.showWarningMessage('请先选择有效的传奇客户端目录');
      return false;
    }
    const selectionError = this.customPatchSelectionError(layout);
    if (selectionError) {
      if (showMessage) vscode.window.showWarningMessage(selectionError);
      return false;
    }
    return true;
  }

  private findEntryIndex(pakPath: string): number {
    const key = normalizePath(pakPath);
    return this.entries.findIndex(entry => normalizePath(entry.path) === key);
  }

  private readEffectImageArchiveNames(): string[] {
    clearPakCache();
    const names: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const index = loadPakIndex(folder.uri.fsPath);
      if (index) {
        names.push(...index.pakList.map(item => (
          item.extension ? `${item.name}.${item.extension}` : item.name
        )));
      }
    }
    return names;
  }

  private resolveWillIndex(pakPath: string, fallback: number): number {
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const index = loadPakIndex(folder.uri.fsPath);
      const matched = index ? matchPakFile(pakPath, index.pakList) : undefined;
      if (matched) return matched.willIdx;
    }
    return fallback;
  }

  private detectWorkspacePasswordFile(dataDirectory: string): string | undefined {
    return findWorkspacePatchPasswordFile(
      this.engine,
      dataDirectory,
      this.workspaceRoots()
    );
  }

  private workspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
  }

  private existingDirectoryUri(candidate: string): vscode.Uri | undefined {
    if (!candidate) return undefined;
    const directory = isDirectory(candidate) ? candidate : path.dirname(candidate);
    return isDirectory(directory) ? vscode.Uri.file(directory) : undefined;
  }

  private async switchEngine(nextEngine: EngineId): Promise<void> {
    if (this.busy) {
      this.pendingEngine = nextEngine;
      return;
    }
    this.pendingEngine = undefined;
    await this.saveStateForEngine(this.engine, false);
    this.engine = nextEngine;
    this.restoreState(nextEngine);
    this.autoStarted = false;
    await this.saveState();
    this.postState();
    await this.autoLoadOrCache();
  }

  private async finishOperation(): Promise<void> {
    this.busy = false;
    await this.saveState();
    this.postState();
    const pendingEngine = this.pendingEngine;
    this.pendingEngine = undefined;
    if (pendingEngine && pendingEngine !== this.engine) {
      await this.switchEngine(pendingEngine);
    }
  }

  private restoreState(engine: EngineId): void {
    const saved = this.context.workspaceState.get<SavedPatchManagerState>(
      patchManagerStateKey(engine)
    ) || this.context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
    const belongsToEngine = saved && (!saved.engine || saved.engine === engine);
    this.customPatchName = belongsToEngine ? saved.customPatchName || '' : '';
    const layout = belongsToEngine ? clientResourceLayoutFromState(saved) : undefined;
    this.clientDirectory = layout?.clientDirectory || '';
    if (!this.customPatchName && layout?.availableCustomPatchDirectories.length === 1) {
      this.customPatchName = path.basename(layout.availableCustomPatchDirectories[0]);
    }
    this.passwordFile = belongsToEngine ? saved.passwordFile || '' : '';
    this.readScope = 'required';
    // Resource indexes are persistent; the potentially huge previous UI row list is not.
    this.entries = [];
  }

  private async saveState(): Promise<void> {
    await this.saveStateForEngine(this.engine, true);
  }

  private async saveStateForEngine(engine: EngineId, updateActiveAlias: boolean): Promise<void> {
    const layout = this.clientLayout();
    const state = {
      clientDirectory: this.clientDirectory,
      dataDirectory: layout?.dataRoots[0] || '',
      customPatchName: this.customPatchName,
      passwordFile: this.passwordFile,
      entries: [],
      engine,
      stateVersion: 3,
    } satisfies SavedPatchManagerState;
    const writes = [
      this.context.workspaceState.update(patchManagerStateKey(engine), state),
    ];
    if (updateActiveAlias) {
      writes.push(this.context.workspaceState.update(PATCH_MANAGER_STATE_KEY, state));
    }
    await Promise.all(writes);
  }

  private postState(): void {
    const layout = this.clientLayout();
    void this.view?.webview.postMessage({
      type: 'state',
      clientDirectory: this.clientDirectory,
      customPatchName: this.customPatchName,
      customPatchCandidates: layout?.availableCustomPatchDirectories.map(directory => path.basename(directory)) || [],
      customPatchError: layout ? this.customPatchSelectionError(layout) : '',
      passwordFile: this.passwordFile,
      entries: this.entries,
      busy: this.busy,
      archiveLabel: this.archiveLabel(),
      resourceSummary: layout
        ? `自定义补丁 ${layout.customPatchDirectories.length} 个 · Data ${layout.dataRoots.length} · Map ${layout.mapRoots.length} · Wav ${layout.wavRoots.length}`
        : '',
    });
  }

  private postEntry(entry: PatchEntry): void {
    void this.view?.webview.postMessage({ type: 'entryUpdate', entry, busy: this.busy });
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'patch-manager.html');
    return secureWebviewHtml(webview, fs.readFileSync(htmlPath, 'utf8'));
  }

  private archiveLabel(): string {
    return uiEditorArchiveLabel(this.engine);
  }

  private clientLayout(): ClientResourceLayout | undefined {
    if (!this.clientDirectory || !isDirectory(this.clientDirectory)) return undefined;
    return discoverClientResourceLayout(this.clientDirectory, this.customPatchName);
  }

  private customPatchSelectionError(layout: ClientResourceLayout): string {
    if (layout.availableCustomPatchDirectories.length <= 1 && !this.customPatchName) return '';
    if (!this.customPatchName) return '检测到多个自定义补丁目录，请输入当前工作区使用的文件夹名';
    if (layout.customPatchDirectories.length === 0) {
      return `客户端中未找到自定义补丁文件夹：${this.customPatchName}`;
    }
    return '';
  }

  private passwordDataRoot(filePath: string): string {
    const layout = this.clientLayout();
    if (!layout) return path.dirname(filePath);
    return layout.dataRoots.find(root => isPathInside(filePath, root))
      || layout.dataRoots[0]
      || path.dirname(filePath);
  }

  private readPasswordRecords(): ReturnType<typeof readPakPasswordRecords> {
    if (!isFile(this.passwordFile)) return [];
    return readPakPasswordRecords(this.passwordFile);
  }

  private storageModeForPath(filePath: string): 'direct' | 'legacy' {
    return isPairedArchiveExtension(path.extname(filePath).slice(1).toLowerCase())
      ? 'direct'
      : this.archivePreviewMode();
  }

  private archivePreviewMode(): 'direct' | 'legacy' {
    return vscode.workspace.getConfiguration('boo').get<'direct' | 'legacy'>(
      'archivePreviewMode',
      'direct'
    );
  }
}

function isDirectory(candidate: string): boolean {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

function normalizePath(filePath: string): string {
  return filePath ? path.normalize(path.resolve(filePath)).toLowerCase() : '';
}

function isPathInside(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
  );
}

function patchValidationMessage(
  validation: PatchReadValidation,
  slotCount?: number,
  archiveLabel = 'PAK'
): string {
  switch (validation.reason) {
    case 'match':
      return `MD5 一致，资源已就绪，共 ${slotCount || 0} 项`;
    case 'changed':
      return `检测到 ${archiveLabel} 内容变化，等待重载`;
    case 'metadata-changed':
      return `检测到 ${archiveLabel} 文件时间变化，等待刷新索引`;
    case 'legacy':
      return '旧兼容缓存缺少 MD5，等待重新读取';
    case 'incomplete':
      return '资源索引不完整，等待重新读取';
    case 'source-missing':
      return `源 ${archiveLabel} 已不存在`;
    case 'read-error':
      return 'MD5 读取失败，等待重新读取';
    case 'decoder-outdated':
      return '图片透明规则已更新，等待重新读取';
    default:
      return '等待读取';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
