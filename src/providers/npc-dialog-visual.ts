import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadStaticLanguageData } from '../data/loader';
import {
  cachedPatchImageUri,
  webviewResourceRoots,
} from '../utils/archive-resource-provider';
import {
  clientResourceLayoutFromState,
} from '../utils/client-resources';
import { getEngineDefinition, normalizeEngineId } from '../utils/engine-registry';
import { findMir200Directory } from '../utils/map-entities';
import { loadPakIndex } from '../utils/pak';
import {
  findCachedPatchImage,
  isPatchCacheCurrent,
  loadCachedPatchAssetTable,
  patchImagePath,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  CachedPatchAssetTable,
  CachedPatchPak,
  SavedPatchManagerState,
} from '../utils/patch-cache';
import { getPatchCacheRoot } from '../utils/cache-storage';
import { decodeTextFile } from '../utils/text';
import { ScriptDataResolver } from '../utils/script-data-resolver';
import { resolveItemImageReference } from '../utils/item-image';
import { uiEditorArchiveExtensions } from '../utils/ui-archive';
import { secureWebviewHtml } from '../utils/webview-security';
import { EngineId } from '../types';
import {
  DialogAssetPreview,
  DialogAssetReference,
  DialogCoordinateChange,
  DialogElement,
  NpcDialogDocumentModel,
  NpcDialogOffsets,
} from '../ui-dialog/model';
import { parseNpcDialogOffsets, workspaceNpcDialogOffsets } from '../ui-dialog/offsets';
import { buildDialogCoordinateEdits } from '../ui-dialog/source-patcher';
import { parseNpcDialogDocument } from '../ui-dialog/source-parser';
import { buildDialogStatementCatalog } from '../ui-dialog/statement-catalog';

export const OPEN_NPC_DIALOG_VISUAL_COMMAND = 'boo.openNpcDialogVisualEditor';

const GEE_OFFSET_STATE_KEY = 'boo.npcDialogVisual.geeMemoOffset';
const FLOATING_WINDOW_COMMAND = 'workbench.action.moveEditorToNewWindow';

interface StoredGeeOffset {
  x: number;
  y: number;
}

interface NpcDialogSession {
  key: string;
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  model: NpcDialogDocumentModel;
  sourceViewColumn: vscode.ViewColumn | undefined;
  dirty: boolean;
  conflict: boolean;
  applying: boolean;
  floatingStarted: boolean;
  previewConditions: Record<string, boolean>;
  modelRevision: number;
  disposables: vscode.Disposable[];
}

interface NpcDialogWebviewMessage {
  type?: string;
  changes?: DialogCoordinateChange[];
  elementId?: string;
  dirty?: boolean;
  x?: number;
  y?: number;
  groupId?: string;
  satisfied?: boolean;
}

export function registerNpcDialogVisualEditor(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const manager = new NpcDialogVisualEditorManager(context);
  const command = vscode.commands.registerCommand(
    OPEN_NPC_DIALOG_VISUAL_COMMAND,
    () => manager.openFromActiveEditor()
  );
  return vscode.Disposable.from(command, manager);
}

class NpcDialogVisualEditorManager implements vscode.Disposable {
  private readonly sessions = new Map<string, NpcDialogSession>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly staticLanguage;
  private readonly scriptDataResolver = new ScriptDataResolver();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.staticLanguage = loadStaticLanguageData(context.extensionPath, message => {
      console.info(`[BOO NPC界面] ${message}`);
    });
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => this.onDocumentChanged(event)),
      vscode.workspace.onDidCloseTextDocument(document => this.onDocumentClosed(document)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('boo.engine')) return;
        for (const session of this.sessions.values()) {
          void this.reloadSession(session, true, session.dirty);
        }
      })
    );
  }

  async openFromActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开 NPC 脚本并将光标放在 [@函数] 内');
      return;
    }
    if (!this.staticLanguage) {
      vscode.window.showErrorMessage('界面语句目录加载失败，无法启动 NPC 界面可视化编辑器');
      return;
    }
    const document = editor.document;
    if (document.uri.scheme !== 'file' || path.extname(document.fileName).toLowerCase() !== '.txt') {
      vscode.window.showWarningMessage('NPC 界面可视化编辑器仅支持工作区中的 TXT 脚本');
      return;
    }

    let model: NpcDialogDocumentModel;
    try {
      model = await this.createModel(document, document.offsetAt(editor.selection.active));
    } catch (error) {
      vscode.window.showWarningMessage(errorMessage(error));
      return;
    }
    const key = `${document.uri.toString()}#${model.functionLabel.toUpperCase()}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn || vscode.ViewColumn.Beside, false);
      await this.postModel(existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'booNpcDialogVisualEditor',
      `NPC界面 ${model.functionLabel}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: webviewResourceRoots([
          this.context.extensionPath,
          path.join(this.context.extensionPath, 'media'),
          getPatchCacheRoot(this.context),
        ]),
      }
    );
    const session: NpcDialogSession = {
      key,
      panel,
      document,
      model,
      sourceViewColumn: editor.viewColumn,
      dirty: false,
      conflict: false,
      applying: false,
      floatingStarted: false,
      previewConditions: Object.fromEntries(
        model.conditionGroups.map(group => [group.id, group.satisfied])
      ),
      modelRevision: 0,
      disposables: [],
    };
    session.disposables.push(
      panel.onDidDispose(() => this.disposeSession(session)),
      panel.webview.onDidReceiveMessage(message => this.onMessage(session, message))
    );
    this.sessions.set(key, session);
    panel.webview.html = this.webviewHtml(panel.webview);
  }

  dispose(): void {
    for (const session of [...this.sessions.values()]) session.panel.dispose();
    this.sessions.clear();
    this.scriptDataResolver.dispose();
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
  }

  private async createModel(
    document: vscode.TextDocument,
    cursorOffset: number,
    functionLabel?: string,
    conditionStates?: Readonly<Record<string, boolean>>
  ): Promise<NpcDialogDocumentModel> {
    if (!this.staticLanguage) throw new Error('界面语句目录尚未加载');
    await this.scriptDataResolver.prepareFor(document.fileName);
    const engine = normalizeEngineId(
      vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
    );
    const definition = getEngineDefinition(engine);
    const text = document.getText();
    const labelOffset = functionLabel
      ? findFunctionLabelOffset(text, functionLabel) ?? cursorOffset
      : cursorOffset;
    const offsets = this.dialogOffsets(document, engine);
    const catalog = buildDialogStatementCatalog(this.staticLanguage, engine);
    return parseNpcDialogDocument(text, {
      uri: document.uri.toString(),
      fileName: path.basename(document.fileName),
      filePath: document.fileName,
      documentVersion: document.version,
      engine,
      engineLabel: definition.label,
      cursorOffset: labelOffset,
      offsets,
      catalog,
      conditionStates,
      dataOptions: this.scriptDataResolver.optionsFor(document.fileName),
    });
  }

  private dialogOffsets(document: vscode.TextDocument, engine: EngineId): NpcDialogOffsets {
    const workspaceRoot = workspaceRootForDocument(document);
    const mir200 = workspaceRoot ? findMir200Directory(workspaceRoot) : undefined;
    const setupPath = mir200 ? path.join(mir200, '!Setup.txt') : undefined;
    const setup = setupPath && isFile(setupPath)
      ? parseNpcDialogOffsets(decodeTextFile(fs.readFileSync(setupPath)).text, setupPath)
      : parseNpcDialogOffsets('', setupPath);
    if (engine !== 'GEE') return setup;

    const stored = this.context.workspaceState.get<StoredGeeOffset>(GEE_OFFSET_STATE_KEY);
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return {
        ...workspaceNpcDialogOffsets(stored.x, stored.y),
        menuX: setup.menuX,
        menuY: setup.menuY,
        setupPath,
      };
    }
    if (setup.configured) return setup;
    return { ...setup, source: 'default', configured: false };
  }

  private async onMessage(
    session: NpcDialogSession,
    message: NpcDialogWebviewMessage
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.postModel(session);
          void this.moveToFloatingWindow(session);
          return;
        case 'dirtyChanged':
          session.dirty = Boolean(message.dirty);
          return;
        case 'reload':
          if (!(await this.confirmDiscardDrafts(session, '重新载入'))) return;
          await this.reloadSession(session, true);
          return;
        case 'apply':
          await this.applyChanges(session, message.changes || [], false);
          return;
        case 'save':
          await this.applyChanges(session, message.changes || [], true);
          return;
        case 'locate':
          await this.locateElement(session, String(message.elementId || ''));
          return;
        case 'openPatchManager':
          await vscode.commands.executeCommand('workbench.view.extension.boo-patch');
          return;
        case 'saveGeeOffsets':
          await this.saveGeeOffsets(session, message.x, message.y);
          return;
        case 'previewCondition':
          await this.previewCondition(
            session,
            String(message.groupId || ''),
            message.satisfied === true
          );
          return;
        case 'resetPreview':
          await this.resetPreview(session);
          return;
      }
    } catch (error) {
      const messageText = errorMessage(error);
      void session.panel.webview.postMessage({ type: 'operationError', message: messageText });
      vscode.window.showErrorMessage(`NPC 界面编辑失败: ${messageText}`);
    }
  }

  private async applyChanges(
    session: NpcDialogSession,
    changes: DialogCoordinateChange[],
    save: boolean
  ): Promise<void> {
    if (session.conflict || session.document.version !== session.model.documentVersion) {
      session.conflict = true;
      void session.panel.webview.postMessage({
        type: 'conflict',
        message: '源码已发生变化，请先重新载入，避免覆盖文本修改',
      });
      return;
    }
    const currentText = session.document.getText();
    const edits = buildDialogCoordinateEdits(currentText, session.model, changes);
    session.applying = true;
    try {
      if (edits.replacements.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const replacement of edits.replacements) {
          workspaceEdit.replace(
            session.document.uri,
            new vscode.Range(
              session.document.positionAt(replacement.start),
              session.document.positionAt(replacement.end)
            ),
            replacement.text
          );
        }
        const applied = await vscode.workspace.applyEdit(workspaceEdit);
        if (!applied) throw new Error('VS Code 未接受坐标修改');
      }
      if (save && !(await session.document.save())) throw new Error('文件保存失败');
    } finally {
      this.updateSessionState(session, { applying: false });
    }
    if (!this.updateSessionState(session, { dirty: false, conflict: false })) return;
    await this.reloadSession(session, false);
    void session.panel.webview.postMessage({
      type: 'operationComplete',
      message: save
        ? `已保存 ${edits.changedElements} 个元素的坐标`
        : `已应用 ${edits.changedElements} 个元素，可用 Ctrl+Z 撤销`,
      saved: save,
    });
  }

  private async saveGeeOffsets(
    session: NpcDialogSession,
    rawX: number | undefined,
    rawY: number | undefined
  ): Promise<void> {
    if (session.model.engine !== 'GEE') throw new Error('只有翎风引擎使用手动缓存的坐标修正');
    if (!(await this.confirmDiscardDrafts(session, '修改坐标修正值'))) return;
    const x = normalizeOffset(rawX);
    const y = normalizeOffset(rawY);
    await this.context.workspaceState.update(GEE_OFFSET_STATE_KEY, { x, y });
    if (!this.updateSessionState(session, { dirty: false })) return;
    await this.reloadSession(session, true);
    void session.panel.webview.postMessage({
      type: 'operationComplete',
      message: `翎风坐标修正已按当前工作区缓存为 ${x}, ${y}`,
    });
  }

  private async confirmDiscardDrafts(
    session: NpcDialogSession,
    action: string
  ): Promise<boolean> {
    if (!session.dirty) return true;
    const selected = await vscode.window.showWarningMessage(
      `${action}会放弃当前尚未应用到代码的坐标草稿。`,
      { modal: true },
      '放弃草稿并继续'
    );
    return selected === '放弃草稿并继续';
  }

  private async previewCondition(
    session: NpcDialogSession,
    groupId: string,
    satisfied: boolean
  ): Promise<void> {
    if (!session.model.conditionGroups.some(group => group.id === groupId)) {
      throw new Error('条件已发生变化，请重新载入后再切换');
    }
    session.previewConditions[groupId] = satisfied;
    await this.reloadSession(session, false, true);
  }

  private async resetPreview(session: NpcDialogSession): Promise<void> {
    session.previewConditions = Object.fromEntries(
      session.model.conditionGroups.map(group => [group.id, false])
    );
    await this.reloadSession(session, false, true);
  }

  private normalizedPreviewConditions(
    model: NpcDialogDocumentModel,
    values: Readonly<Record<string, boolean>>
  ): Record<string, boolean> {
    return Object.fromEntries(
      model.conditionGroups.map(group => [group.id, values[group.id] === true])
    );
  }

  private async reloadSession(
    session: NpcDialogSession,
    userInitiated: boolean,
    preserveDrafts = false
  ): Promise<void> {
    const revision = ++session.modelRevision;
    const previewConditions = { ...session.previewConditions };
    try {
      const model = await this.createModel(
        session.document,
        session.model.functionStart,
        session.model.functionLabel,
        previewConditions
      );
      if (revision !== session.modelRevision) return;
      session.previewConditions = this.normalizedPreviewConditions(model, previewConditions);
      if (!this.updateSessionState(session, {
        model,
        dirty: preserveDrafts ? session.dirty : false,
        conflict: false,
      })) return;
      session.panel.title = `NPC界面 ${session.model.functionLabel}`;
      await this.postModel(session, preserveDrafts, revision);
    } catch (error) {
      if (revision !== session.modelRevision) return;
      if (!this.updateSessionState(session, { conflict: true })) return;
      void session.panel.webview.postMessage({ type: 'conflict', message: errorMessage(error) });
      if (userInitiated) vscode.window.showWarningMessage(errorMessage(error));
    }
  }

  private updateSessionState(
    session: NpcDialogSession,
    state: Partial<Pick<NpcDialogSession, 'model' | 'dirty' | 'conflict' | 'applying'>>
  ): boolean {
    if (this.sessions.get(session.key) !== session) return false;
    Object.assign(session, state);
    return true;
  }

  private async postModel(
    session: NpcDialogSession,
    preserveDrafts = false,
    revision = session.modelRevision
  ): Promise<void> {
    const model = session.model;
    await this.hydrateAssets(model, session.panel.webview, session.document);
    if (
      this.sessions.get(session.key) !== session
      || session.model !== model
      || session.modelRevision !== revision
    ) return;
    void session.panel.webview.postMessage({
      type: 'model',
      model,
      preserveDrafts,
      previewRevision: revision,
      geeOffsetHelp: model.engine === 'GEE'
        ? '请在登陆器配置 - 客户端界面设置 - 其他配置 - NPC对话框文字坐标修正中查看数值'
        : '',
    });
  }

  private async hydrateAssets(
    model: NpcDialogDocumentModel,
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): Promise<void> {
    const cache = new Map<string, DialogAssetPreview>();
    const archiveCache = new Map<string, CachedPatchPak>();
    const assetTableCache = new Map<string, CachedPatchAssetTable>();
    const resolve = (reference: DialogAssetReference | undefined): DialogAssetPreview | undefined => {
      if (!reference) return undefined;
      const key = JSON.stringify(reference);
      const existing = cache.get(key);
      if (existing) return existing;
      const preview = this.resolveAsset(
        reference,
        model.engine,
        webview,
        document,
        archiveCache,
        assetTableCache
      );
      cache.set(key, preview);
      return preview;
    };
    for (const scene of model.scenes) {
      if (scene.background) scene.background.asset = resolve(scene.background.assetRef);
      for (const element of scene.elements) {
        element.asset = resolve(element.assetRef);
        const layers = (element.assetLayers || [])
          .filter(layer => layer.role !== 'item')
          .map(layer => ({ ...layer, asset: resolve(layer.assetRef) }));
        const itemReference = this.resolveItemAssetReference(element, document);
        if (itemReference) {
          layers.push({
            role: 'item',
            assetRef: itemReference,
            asset: resolve(itemReference),
          });
        }
        element.assetLayers = layers.length > 0 ? layers : undefined;
        if (
          element.animationPreview
          && element.assetRef
          && Number.isInteger(element.assetRef.imageIndex)
        ) {
          const requested = Math.max(1, element.animationPreview.frameCount);
          const frameCount = Math.min(240, requested);
          element.animationFrames = Array.from({ length: frameCount }, (_, index) => (
            resolve({
              ...element.assetRef!,
              imageIndex: element.assetRef!.imageIndex! + index,
              frameCount: undefined,
            })!
          ));
          if (requested > frameCount) {
            element.warning = element.warning
              ? `${element.warning}；动画超过 240 帧，预览仅播放前 240 帧`
              : '动画超过 240 帧，预览仅播放前 240 帧';
          }
        } else {
          element.animationFrames = undefined;
        }
      }
    }
  }

  private resolveItemAssetReference(
    element: DialogElement,
    document: vscode.TextDocument
  ): DialogAssetReference | undefined {
    const item = element.itemPreview;
    if (!item) return undefined;

    let looksValue: unknown;
    if (item.mode === 'database-index') {
      if (item.itemIndex === undefined) {
        item.message = '物品 IDX 为动态值，无法静态读取数据库素材';
        return undefined;
      }
      looksValue = this.scriptDataResolver.resolveItemFieldByIndex(
        document.fileName,
        item.itemIndex,
        'Looks'
      );
      if (looksValue === undefined) {
        item.message = `物品数据库中未找到 IDX ${item.itemIndex} 的 Looks`;
        return undefined;
      }
    } else if (item.mode === 'database-name') {
      if (!item.itemName) {
        item.message = '物品名称为动态值，无法静态读取数据库素材';
        return undefined;
      }
      looksValue = this.scriptDataResolver.resolveItemFieldByName(
        document.fileName,
        item.itemName,
        'Looks'
      );
      if (looksValue === undefined) {
        item.message = `物品数据库中未找到 ${item.itemName} 的 Looks`;
        return undefined;
      }
    } else if (item.mode === 'looks') {
      looksValue = item.looks;
    } else if (item.mode === 'direct-archive') {
      if (!item.archiveName || item.imageIndex === undefined) {
        item.message = '资源文件名或图片序号为动态值，无法静态预览';
        return undefined;
      }
      item.message = undefined;
      return {
        archiveName: item.archiveName,
        imageIndex: item.imageIndex,
      };
    } else {
      return undefined;
    }

    const reference = resolveItemImageReference(looksValue);
    if (!reference) {
      item.message = `Looks ${String(looksValue ?? '')} 超出 0-99999 或格式无效`;
      return undefined;
    }
    item.looks = reference.looks;
    item.message = undefined;
    return {
      archiveName: reference.pakName,
      imageIndex: reference.imageIndex,
    };
  }

  private resolveAsset(
    reference: DialogAssetReference,
    engine: EngineId,
    webview: vscode.Webview,
    document: vscode.TextDocument,
    archiveCache: Map<string, CachedPatchPak>,
    assetTableCache: Map<string, CachedPatchAssetTable>
  ): DialogAssetPreview {
    if (!Number.isInteger(reference.imageIndex)) {
      return { status: 'dynamic', message: '图片序号为动态值或未声明' };
    }
    const workspaceRoot = workspaceRootForDocument(document);
    if (!workspaceRoot) return { status: 'missing', message: '未找到当前脚本所属工作区' };

    let archiveName = reference.archiveName?.trim();
    let archiveExtensions = uiEditorArchiveExtensions(engine);
    if (reference.willIndex !== undefined) {
      const entry = loadPakIndex(workspaceRoot)?.pakList.find(item => item.willIdx === reference.willIndex);
      if (!entry) {
        return {
          status: 'missing',
          message: `EffectImageList.txt 未找到 WIL 序号 ${reference.willIndex}`,
        };
      }
      archiveName = entry.extension ? `${entry.name}.${entry.extension}` : entry.name;
      if (entry.extension) archiveExtensions = [entry.extension];
    }
    if (!archiveName) return { status: 'dynamic', message: '资源序号为动态值或未声明' };

    const state = this.patchState(engine);
    const resourceRoots = state ? clientResourceLayoutFromState(state)?.dataRoots || [] : [];
    const archiveKey = `${archiveName.toLowerCase()}|${archiveExtensions.join(',')}`;
    const index = reference.imageIndex!;
    const cachedPak = archiveCache.get(archiveKey);
    let match = cachedPak && isPatchCacheCurrent(cachedPak) && index < cachedPak.slotCount
      ? cachedPatchMatch(cachedPak, index)
      : undefined;
    if (!match) {
      match = findCachedPatchImage(
        getPatchCacheRoot(this.context),
        archiveName,
        index,
        resourceRoots,
        archiveExtensions
      );
      if (match) archiveCache.set(archiveKey, match.pak);
    }
    if (!match) {
      return {
        status: 'missing',
        archiveLabel: `${archiveName}/${String(index).padStart(6, '0')}`,
        message: '素材未缓存或缓存已失效',
      };
    }
    const tableKey = match.pak.archiveId || match.pak.manifestPath;
    let table = assetTableCache.get(tableKey);
    if (!table) {
      table = loadCachedPatchAssetTable(match.pak);
      assetTableCache.set(tableKey, table);
    }
    const uri = cachedPatchImageUri(match);
    return {
      status: 'ready',
      url: webview.asWebviewUri(uri).toString(),
      archiveLabel: `${match.pak.pakName}/${String(index).padStart(6, '0')}`,
      width: table.width[index] || undefined,
      height: table.height[index] || undefined,
      offsetX: table.offsetX[index] || 0,
      offsetY: table.offsetY[index] || 0,
    };
  }

  private patchState(engine: EngineId): SavedPatchManagerState | undefined {
    const state = this.context.workspaceState.get<SavedPatchManagerState>(patchManagerStateKey(engine))
      || this.context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
    return state && (!state.engine || state.engine === engine) ? state : undefined;
  }

  private async locateElement(session: NpcDialogSession, elementId: string): Promise<void> {
    const element = session.model.scenes
      .flatMap(scene => scene.elements)
      .find(candidate => candidate.id === elementId);
    if (!element) throw new Error('找不到对应源码，可能已经被修改');
    const range = new vscode.Range(
      session.document.positionAt(element.sourceRange.start),
      session.document.positionAt(element.sourceRange.end)
    );
    const editor = await vscode.window.showTextDocument(session.document, {
      viewColumn: session.sourceViewColumn || vscode.ViewColumn.One,
      preserveFocus: false,
      selection: range,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async moveToFloatingWindow(session: NpcDialogSession): Promise<void> {
    if (session.floatingStarted) return;
    session.floatingStarted = true;
    await delay(350);
    if (!this.sessions.has(session.key)) return;
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(FLOATING_WINDOW_COMMAND)) {
      void session.panel.webview.postMessage({
        type: 'floatingFallback',
        message: '当前 VS Code 版本不支持独立浮动窗口，已在独立编辑标签中打开',
      });
      return;
    }
    try {
      session.panel.reveal(session.panel.viewColumn || vscode.ViewColumn.Beside, false);
      await vscode.commands.executeCommand(FLOATING_WINDOW_COMMAND);
    } catch (error) {
      console.warn('[BOO] NPC界面移入浮动窗口失败:', errorMessage(error));
      void session.panel.webview.postMessage({
        type: 'floatingFallback',
        message: '自动移入浮动窗口失败，可右键此标签选择“移动到新窗口”',
      });
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    for (const session of this.sessions.values()) {
      if (session.document.uri.toString() !== event.document.uri.toString() || session.applying) continue;
      if (session.dirty) {
        session.conflict = true;
        void session.panel.webview.postMessage({
          type: 'conflict',
          message: '源码在可视化草稿期间发生变化，请重新载入后继续',
        });
      } else {
        void this.reloadSession(session, false);
      }
    }
  }

  private onDocumentClosed(document: vscode.TextDocument): void {
    for (const session of this.sessions.values()) {
      if (session.document.uri.toString() !== document.uri.toString()) continue;
      session.conflict = true;
      void session.panel.webview.postMessage({
        type: 'conflict',
        message: '源文件已关闭，请重新打开源文件后重新载入',
      });
    }
  }

  private disposeSession(session: NpcDialogSession): void {
    this.sessions.delete(session.key);
    session.disposables.splice(0).forEach(disposable => disposable.dispose());
  }

  private webviewHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.html');
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.css'))
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'npc-dialog-visual.js'))
    );
    const html = fs.readFileSync(htmlPath, 'utf8')
      .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
      .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString());
    return secureWebviewHtml(webview, html);
  }
}

function workspaceRootForDocument(document: vscode.TextDocument): string | undefined {
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function findFunctionLabelOffset(text: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\uFEFF?\\s*\\[${escaped}\\]`, 'im').exec(text);
  return match?.index;
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) throw new Error('坐标修正必须是整数');
  const result = Math.trunc(value!);
  if (Math.abs(result) > 10000) throw new Error('坐标修正超出允许范围');
  return result;
}

function isFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function cachedPatchMatch(
  pak: CachedPatchPak,
  imageIndex: number
): { pak: CachedPatchPak; imagePath: string; archiveId?: string; imageIndex: number } | undefined {
  if (pak.storageMode === 'direct' && pak.archiveId) {
    return { pak, imagePath: '', archiveId: pak.archiveId, imageIndex };
  }
  const imagePath = patchImagePath(pak, imageIndex);
  return imagePath && isFile(imagePath) ? { pak, imagePath, imageIndex } : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
