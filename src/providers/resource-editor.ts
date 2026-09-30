import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { decodeResourcePng, readResourceImage } from '../resource-editor/image-codec';
import { encodePng } from '../utils/pak-reader';
import type { AnimationFrame } from '../resource-editor/animation';
import { ArchiveIndexSummary, assertArchiveReadCurrent, inspectArchiveSlots, loadArchiveSummary, openArchiveIndexed } from '../utils/archive-index';
import { archiveResourceUri } from '../utils/archive-resource-provider';
import { getArchiveIndexRoot } from '../utils/cache-storage';
import { secureWebviewHtml } from '../utils/webview-security';
import { ArchiveExportSelection, exportArchiveImages } from '../resource-editor/export';
import { parseResourceEditorMessage, RESOURCE_EDITOR_PAGE_SIZE, ResourceEditorMessage, ResourceEditorSlot, resourceEditorPageStart } from '../resource-editor/model';
import { EditInfo, EditWorkerError, ArchiveEditClient } from '../resource-editor/edit-client';
import type { ResourceBatchRequest, ResourceClipboardFrame } from '../resource-editor/batch';

export const RESOURCE_EDITOR_OPEN_COMMAND = 'boo.resourceEditor.open';
export const RESOURCE_EDITOR_VIEW_TYPE = 'boo.resourceEditor';

interface InspectRequest { index: number; requestId: number; documentId: string }
interface ResourcePanel {
  panel: vscode.WebviewPanel;
  summary: ArchiveIndexSummary;
  sessionId: string;
  documentId: string;
  documents: Set<string>;
  lastRequestId: number;
  start: number;
  focusIndex?: number;
  busy: boolean;
  disposed: boolean;
  exportAbort?: AbortController;
  inspectRequest?: InspectRequest;
  inspecting: boolean;
  listeners: vscode.Disposable[];
  password?: string;
  editClient?: ArchiveEditClient;
  editInfo?: EditInfo;
  editTask?: Promise<void>;
  draftRoot?: string;
  draftFiles: Map<string, string>;
  pageEpoch: number;
  indexUnavailable: boolean;
  savedTarget?: string;
  closePrompt: boolean;
  notice?: string;
}

/** Browsing stays read-only; verified JPK edits live in a private worker until save-as. */
export class ResourceEditorProvider implements vscode.Disposable {
  private clipboard?: ResourceClipboardFrame[];
  private readonly panels = new Map<string, ResourcePanel>();
  private disposed = false;
  private readonly indexRoot: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.indexRoot = getArchiveIndexRoot(context);
  }

  async openArchive(archiveId: string, password?: string): Promise<void> {
    if (this.disposed) return;
    if (!/^[a-f0-9]{64}$/.test(archiveId)) throw new Error('资源索引标识无效');
    const existing = this.panels.get(archiveId);
    if (existing?.editInfo || existing?.closePrompt) {
      if (!existing.disposed) existing.panel.reveal(undefined, false);
      else if (!existing.closePrompt) await this.protectClosedEdit(existing);
      return;
    }
    const summary = loadArchiveSummary(this.indexRoot, archiveId);
    assertArchiveReadCurrent(this.indexRoot, summary);
    if (existing && existing.summary.indexGeneration === summary.indexGeneration) {
      existing.panel.reveal(undefined, false);
      return;
    }
    if (existing?.busy) throw new Error('此资源正在导出，请结束任务后重新打开');
    existing?.panel.dispose();
    if (this.panels.size >= 8) throw new Error('请先关闭一个资源工作台（最多同时打开 8 个）');
    const panel = this.createPanel(summary);
    const entry: ResourcePanel = { panel, summary, sessionId: crypto.randomBytes(16).toString('hex'),
      documentId: '', documents: new Set(), lastRequestId: 0, start: 0, busy: false, disposed: false,
      inspecting: false, listeners: [], password, draftFiles: new Map(), pageEpoch: 0,
      indexUnavailable: false, closePrompt: false };
    this.panels.set(archiveId, entry);
    this.attachPanel(entry);
  }

  private createPanel(summary: ArchiveIndexSummary): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(RESOURCE_EDITOR_VIEW_TYPE,
      `资源 · ${path.basename(summary.pakPath)}`, vscode.ViewColumn.Active, {
        enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'resources')),
          vscode.Uri.parse(`boo-archive:/${summary.archiveId}/`)],
      });
  }

  private attachPanel(entry: ResourcePanel): void {
    const panel = entry.panel;
    this.updateRoots(entry);
    entry.listeners.push(panel.onDidDispose(() => {
      entry.disposed = true;
      entry.exportAbort?.abort();
      for (const listener of entry.listeners.splice(0)) listener.dispose();
      if (!this.disposed && (entry.editClient || entry.editTask)) void this.protectClosedEdit(entry);
      else this.release(entry);
    }));
    entry.listeners.push(panel.webview.onDidReceiveMessage(value => { void this.handleMessage(entry, value); }));
    try {
      const html = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'resource-editor.html'), 'utf8');
      const iconUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'icon.png'))).toString();
      panel.webview.html = secureWebviewHtml(panel.webview, html.replace(/\{\{ICON_URI\}\}/g, escapeAttribute(iconUri)));
    } catch (error) { panel.dispose(); throw error; }
  }

  dispose(): void {
    this.clipboard = undefined;
    this.disposed = true;
    for (const entry of [...this.panels.values()]) {
      entry.panel.dispose();
      this.release(entry);
    }
    this.panels.clear();
  }

  private alive(entry: ResourcePanel): boolean {
    return !this.disposed && !entry.disposed && this.panels.get(entry.summary.archiveId) === entry;
  }

  private post(entry: ResourcePanel, message: Record<string, unknown>): void {
    if (this.alive(entry) && entry.documentId) {
      void entry.panel.webview.postMessage({ ...message, sessionId: entry.sessionId, documentId: entry.documentId });
    }
  }

  private current(entry: ResourcePanel): void {
    if (!this.alive(entry)) throw new Error('资源工作台已关闭');
    if (entry.indexUnavailable) throw new Error('新包已保存，但索引尚未重建');
    const current = loadArchiveSummary(this.indexRoot, entry.summary.archiveId);
    if (current.indexGeneration !== entry.summary.indexGeneration) throw new Error('资源索引已变化');
    assertArchiveReadCurrent(this.indexRoot, entry.summary);
  }

  private async slots(entry: ResourcePanel, indices: number[]): Promise<ResourceEditorSlot[]> {
    if (entry.editClient && entry.editInfo) {
      const client = entry.editClient, revision = entry.editInfo.revision;
      const slots = indices.length ? await client.slots(indices[0], indices.length) : [];
      for (const slot of slots) {
        if (slot.status === 'empty') continue;
        if (slot.modified || entry.indexUnavailable) {
          slot.imageUrl = await this.draftImage(entry, client, slot.index, revision);
        } else {
          slot.imageUrl = entry.panel.webview.asWebviewUri(archiveResourceUri(entry.summary.archiveId, slot.index)
            .with({ query: `generation=${entry.summary.indexGeneration}` })).toString();
        }
      }
      return slots;
    }
    this.current(entry);
    return inspectArchiveSlots(this.indexRoot, entry.summary.archiveId, entry.summary.indexGeneration, indices).map(slot => {
      const metadata = slot.metadata;
      const canPreview = metadata && !['empty', 'corrupt', 'unsupported'].includes(slot.status);
      return { index: slot.logicalIndex, status: slot.status,
        ...(metadata ? { width: metadata.width, height: metadata.height,
          offsetX: metadata.offsetX ?? null, offsetY: metadata.offsetY ?? null,
          pixelFormat: metadata.pixelFormat, compression: metadata.compression, alpha: metadata.alpha } : {}),
        ...(canPreview ? { imageUrl: entry.panel.webview.asWebviewUri(archiveResourceUri(entry.summary.archiveId, slot.logicalIndex)
          .with({ query: `generation=${entry.summary.indexGeneration}` })).toString() } : {}),
      };
    });
  }

  private async postPage(entry: ResourcePanel, requestId?: number): Promise<void> {
    const epoch = ++entry.pageEpoch, revision = entry.editInfo?.revision ?? 0, documentId = entry.documentId;
    const count = this.slotCount(entry);
    entry.start = Math.min(entry.start, Math.max(0, Math.floor((count - 1) / RESOURCE_EDITOR_PAGE_SIZE) * RESOURCE_EDITOR_PAGE_SIZE));
    if (entry.focusIndex !== undefined && entry.focusIndex >= count) entry.focusIndex = undefined;
    const end = Math.min(entry.start + RESOURCE_EDITOR_PAGE_SIZE, count);
    const indices = Array.from({ length: end - entry.start }, (_, offset) => entry.start + offset);
    const slots = await this.slots(entry, indices);
    if (!this.alive(entry) || epoch !== entry.pageEpoch || revision !== (entry.editInfo?.revision ?? 0) || documentId !== entry.documentId) return;
    entry.panel.title = `资源 · ${path.basename(entry.savedTarget || entry.summary.pakPath)}${entry.editInfo?.dirty ? ' *' : ''}`;
    this.post(entry, { type: 'state', name: path.basename(entry.savedTarget || entry.summary.pakPath), format: entry.summary.format,
      profileId: entry.editInfo?.profileId || entry.summary.profileId || 'unknown', slotCount: count,
      pageSize: RESOURCE_EDITOR_PAGE_SIZE, start: entry.start, slots,
      notice: entry.notice,
      focusIndex: entry.focusIndex, busy: entry.busy, requestId, canEdit: !!entry.editInfo, canExport: !entry.editInfo,
      editActive: !!entry.editInfo, editRevision: revision, dirty: entry.editInfo?.dirty ?? false,
      canUndo: entry.editInfo?.canUndo ?? false, canRedo: entry.editInfo?.canRedo ?? false,
      capabilities: entry.editInfo?.capabilities ?? {}, saveMode: entry.editInfo?.saveMode || 'file', canStartEdit: !entry.editInfo && this.editEligible(entry) });
  }

  private async handleMessage(entry: ResourcePanel, value: unknown): Promise<void> {
    if (!this.alive(entry)) return;
    let message;
    try { message = parseResourceEditorMessage(value, entry.sessionId, entry.documentId, this.slotCount(entry)); }
    catch { return; } // Reject untrusted protocol data without echoing values or paths.
    try {
      if (message.type === 'ready') {
        if (entry.documentId !== message.documentId) {
          // A destroyed iframe must not revive its identity through a delayed ready event.
          if (entry.documents.has(message.documentId) || entry.documents.size >= 128) return;
          entry.documents.add(message.documentId);
          entry.documentId = message.documentId;
          entry.lastRequestId = 0;
          entry.inspectRequest = undefined;
        }
        await this.postPage(entry);
        return;
      }
      if (message.requestId <= entry.lastRequestId) return;
      entry.lastRequestId = message.requestId;
      if (message.type === 'cancelExport') {
        entry.exportAbort?.abort();
        this.post(entry, { type: 'notice', text: '正在取消并核对导出结果…', busy: entry.busy });
        return;
      }
      if (message.type === 'animation' || message.type === 'reference' || message.type === 'exportAnimation') {
        if (!entry.busy) await this.previewTools(entry, message);
        return;
      }
      if (['beginEdit', 'importImage', 'clearSlot', 'setOffsets', 'batchTools', 'undo', 'redo', 'saveAs', 'endEdit'].includes(message.type)) {
        if (entry.busy) return;
        entry.editTask = this.editAction(entry, message);
        await entry.editTask;
        entry.editTask = undefined;
        return;
      }
      if (!entry.editInfo) this.current(entry);
      switch (message.type) {
        case 'page':
          entry.start = message.start;
          await this.postPage(entry, message.requestId);
          return;
        case 'jump':
          entry.start = resourceEditorPageStart(message.index, this.slotCount(entry));
          entry.focusIndex = message.index;
          await this.postPage(entry, message.requestId);
          this.requestInspect(entry, message.index, message.requestId);
          return;
        case 'inspect':
          entry.focusIndex = message.index;
          this.requestInspect(entry, message.index, message.requestId);
          return;
        case 'export':
          if (!entry.busy && !entry.editInfo) await this.exportImages(entry, message.selection, message.documentId);
          return;
      }
    } catch {
      this.post(entry, { type: 'notice', text: '资源已变化或无法读取，请在补丁管理中重载后重新打开。', busy: entry.busy });
    }
  }

  private requestInspect(entry: ResourcePanel, index: number, requestId: number): void {
    entry.inspectRequest = { index, requestId, documentId: entry.documentId };
    void this.drainInspections(entry);
  }

  private slotCount(entry: ResourcePanel): number { return entry.editInfo?.slotCount ?? entry.summary.slotCount; }
  private editEligible(entry: ResourcePanel): boolean {
    const known = entry.summary.format === 'JPK' && /^jpk-(GameLib|996M2)$/.test(entry.summary.profileId || '')
      || entry.summary.format === 'GOM' && entry.summary.profileId === 'gom-gameofmir2-v2'
      || process.platform === 'win32' && (entry.summary.format === 'WIL' || entry.summary.format === 'WZL');
    return known && !entry.summary.skippedMalformedCount && !entry.summary.rejectedSlots?.length;
  }
  private updateRoots(entry: ResourcePanel): void {
    entry.panel.webview.options = { enableScripts: true, localResourceRoots: [
      vscode.Uri.file(path.join(this.context.extensionPath, 'resources')),
      vscode.Uri.parse(`boo-archive:/${entry.summary.archiveId}/`),
      ...(entry.draftRoot ? [vscode.Uri.file(entry.draftRoot)] : []),
    ] };
  }
  private async draftImage(entry: ResourcePanel, client: ArchiveEditClient, index: number, revision: number): Promise<string> {
    const key = `${revision}-${index}`;
    let file = entry.draftFiles.get(key);
    if (!file) {
      const png = await client.preview(index);
      if (entry.editClient !== client || revision !== entry.editInfo?.revision || !this.alive(entry)) throw new Error('草稿已变化');
      if (!entry.draftRoot) throw new Error('草稿目录不存在');
      file = entry.draftFiles.get(key);
      if (!file) {
        if (entry.draftFiles.size >= 200) this.clearDraftImages(entry);
        file = path.join(entry.draftRoot, `${key}.png`);
        // Only generated numeric filenames in our unique temporary directory are written.
        fs.writeFileSync(file, png, { flag: 'wx' });
        entry.draftFiles.set(key, file);
      }
    }
    return entry.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
  }
  private clearDraftImages(entry: ResourcePanel): void {
    for (const file of entry.draftFiles.values()) {
      if (entry.draftRoot && path.dirname(file) === entry.draftRoot) {
        try { fs.unlinkSync(file); } catch { /* Only our exact generated PNG may be removed. */ }
      }
    }
    entry.draftFiles.clear();
  }
  private stopEditing(entry: ResourcePanel): void {
    void entry.editClient?.dispose().catch(() => undefined);
    entry.editClient = undefined; entry.editInfo = undefined;
    this.clearDraftImages(entry);
    if (entry.draftRoot) { try { fs.rmdirSync(entry.draftRoot); } catch { /* Never recursively remove unexpected content. */ } }
    entry.draftRoot = undefined;
    if (!entry.disposed) this.updateRoots(entry);
  }
  private release(entry: ResourcePanel): void {
    this.stopEditing(entry);
    entry.password = undefined;
    for (const [key, current] of this.panels) if (current === entry) this.panels.delete(key);
  }
  private async protectClosedEdit(entry: ResourcePanel): Promise<void> {
    if (entry.closePrompt) return;
    entry.closePrompt = true;
    let restoreFailed = false;
    try {
      await entry.editTask;
      if (this.disposed) { this.release(entry); return; }
      if (!entry.editInfo?.dirty) { this.release(entry); return; }
      const choice = await vscode.window.showWarningMessage('资源草稿尚未保存。', { modal: true }, '另存新包', '放弃修改', '继续编辑');
      if (this.disposed || choice === '放弃修改') { this.release(entry); return; }
      // WebviewPanel has no vetoable close event. Retain the worker and restore its tab on Cancel.
      entry.disposed = false; entry.documentId = ''; entry.documents.clear(); entry.lastRequestId = 0;
      entry.inspectRequest = undefined; entry.panel = this.createPanel(entry.summary); this.attachPanel(entry);
      if (choice === '另存新包') {
        entry.busy = true;
        try { await this.saveEdit(entry); }
        catch (error) { this.editNotice(entry, error); }
        finally { entry.busy = false; if (this.alive(entry) && entry.documentId) await this.postPage(entry); }
      }
    } catch {
      // A host/dialog failure is not consent to discard an unsaved worker session.
      // Retain it so reopening this archive can retry restoration, without a prompt loop.
      restoreFailed = true;
      entry.disposed = true;
      void vscode.window.showWarningMessage('工作台恢复失败，草稿仍保留在本次会话中。请重新打开该资源包；不要重启 VS Code。').then(undefined, () => undefined);
    }
    finally {
      entry.closePrompt = false;
      if (!restoreFailed && entry.disposed && !this.disposed && entry.editClient) void this.protectClosedEdit(entry);
    }
  }

  private async editAction(entry: ResourcePanel, message: ResourceEditorMessage): Promise<void> {
    if (message.type === 'ready') return;
    const documentId = entry.documentId;
    const active = () => this.alive(entry) && documentId === entry.documentId;
    entry.notice = undefined;
    entry.busy = true;
    this.post(entry, { type: 'busy', busy: true });
    try {
      if (message.type === 'beginEdit') {
        if (entry.editClient || !this.editEligible(entry)) return;
        this.current(entry);
        const pair = entry.summary.format === 'WIL' || entry.summary.format === 'WZL';
        let password = pair ? '' : entry.password;
        if (password === undefined) password = await vscode.window.showInputBox({ title: '开启资源编辑',
          prompt: '输入此资源包的密码（仅用于本次编辑）', password: true, ignoreFocusOut: true });
        if (!active()) return;
        if (password === undefined) { entry.notice = '已取消开启编辑，当前仍为浏览模式。'; return; }
        if (!pair && crypto.createHash('sha256').update(password, 'utf8').digest('hex') !== entry.summary.passwordHash) {
          throw new EditWorkerError('CREDENTIAL_MISMATCH');
        }
        const client = new ArchiveEditClient();
        this.post(entry, { type: 'notice', text: '正在逐图核验编辑资格…', busy: true });
        try {
          const info = await client.open(this.context.extensionPath, entry.summary.pakPath, password);
          if (!active()) { await client.dispose(); return; }
          this.current(entry);
          if (info.sourceSha256 !== entry.summary.sourceSha256) throw new EditWorkerError('SOURCE_CHANGED');
          if (pair ? info.profileId !== `${entry.summary.format.toLowerCase()}-strict-v1` || info.sourceCompanionSha256 !== entry.summary.companionSha256
            : info.profileId !== entry.summary.profileId) throw new EditWorkerError('READONLY_ARCHIVE_PROFILE');
          entry.password = password; entry.editClient = client; entry.editInfo = info;
          entry.draftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-resource-draft-'));
          this.updateRoots(entry);
        } catch (error) { await client.dispose(); entry.editClient = undefined; entry.editInfo = undefined; throw error; }
      } else {
        const client = entry.editClient, info = entry.editInfo;
        if (!client || !info || !('revision' in message) || message.revision !== info.revision) return;
        switch (message.type) {
          case 'batchTools': await this.batchTools(entry, message, active); break;
          case 'importImage': {
            const capability = message.mode === 'append' ? info.capabilities.canAppend : message.mode === 'fill' ? info.capabilities.canFill : info.capabilities.canReplace;
            if (!capability) return;
            const picked = await vscode.window.showOpenDialog({ title: message.mode === 'append' ? '追加图片到新槽位' : '导入图片到当前槽位',
              canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { 'PNG / BMP': ['png', 'bmp'] } });
            if (!picked?.[0] || picked[0].scheme !== 'file' || !active() || info.revision !== entry.editInfo?.revision) return;
            // The target and operation are explicit before any draft mutation.
            const target = message.mode === 'append' ? info.slotCount : message.index!;
            const choice = await vscode.window.showInformationMessage(`${path.basename(picked[0].fsPath)} → ID ${target}（${message.mode === 'replace' ? '替换，保留偏移' : message.mode === 'fill' ? '填空' : '追加'}）`,
              { modal: true }, '导入草稿');
            if (choice !== '导入草稿' || !active()) return;
            entry.editInfo = await client.importImage(message.mode, message.index, picked[0].fsPath, info.revision);
            entry.focusIndex = target; entry.start = resourceEditorPageStart(target, entry.editInfo.slotCount);
            break;
          }
          case 'clearSlot': {
            if (!info.capabilities.canClear) return;
            const chosen = await vscode.window.showWarningMessage(`清空 ID ${message.index}？后续编号不会移动。`, { modal: true }, '清空槽位');
            if (chosen !== '清空槽位' || !active()) return;
            entry.editInfo = await client.clear(message.index, info.revision); break;
          }
          case 'setOffsets':
            if (!info.capabilities.canOffsets) return;
            entry.editInfo = await client.offsets(message.index, message.x, message.y, info.revision); break;
          case 'undo': if (info.canUndo) entry.editInfo = await client.undo(info.revision); break;
          case 'redo': if (info.canRedo) entry.editInfo = await client.redo(info.revision); break;
          case 'saveAs': if (info.capabilities.canSaveAs) await this.saveEdit(entry, active); break;
          case 'endEdit': {
            if (info.dirty) {
              const chosen = await vscode.window.showWarningMessage('结束编辑前如何处理草稿？', { modal: true }, '另存新包', '放弃修改', '继续编辑');
              if (!active() || chosen === undefined || chosen === '继续编辑') return;
              if (chosen === '另存新包' && !await this.saveEdit(entry, active)) return;
            }
            if (entry.indexUnavailable) throw new EditWorkerError('SAVED_INDEX_FAILED');
            this.stopEditing(entry); break;
          }
        }
        this.clearDraftImages(entry);
      }
    } catch (error) { this.editNotice(entry, error); }
    finally {
      entry.busy = false;
      this.post(entry, { type: 'busy', busy: false });
      if (this.alive(entry)) {
        try {
          const requestId = documentId === entry.documentId ? message.requestId : undefined;
          await this.postPage(entry, requestId);
          if (entry.focusIndex !== undefined) this.requestInspect(entry, entry.focusIndex, requestId ?? entry.lastRequestId);
        } catch { this.post(entry, { type: 'notice', text: '资源已变化，请结束编辑后重载。草稿不会写入原包。', busy: false }); }
      }
    }
  }

  private async previewTools(entry: ResourcePanel, message: Extract<ResourceEditorMessage, { type: 'animation' | 'reference' | 'exportAnimation' }>): Promise<void> {
    const documentId = entry.documentId, revision = entry.editInfo?.revision ?? 0;
    const active = () => this.alive(entry) && documentId === entry.documentId && revision === (entry.editInfo?.revision ?? 0);
    entry.busy = true; this.post(entry, { type: 'busy', busy: true });
    try {
      if (message.type === 'reference') {
        const picked = await vscode.window.showOpenDialog({ title: '选择参照图（仅预览，不写入资源包）', canSelectMany: false, filters: { 'PNG / BMP': ['png', 'bmp'] } });
        if (!picked?.[0] || picked[0].scheme !== 'file' || !active()) return;
        const image = readResourceImage(picked[0].fsPath);
        this.post(entry, { type: 'referenceImage', imageUrl: 'data:image/png;base64,' + encodePng(image.width, image.height, image.rgba).toString('base64') });
        return;
      }
      let ids: number[];
      if (message.type === 'animation') {
        const value = await vscode.window.showInputBox({ title: '动画起止 ID（包含空槽，最多 256 帧）', value: String(entry.focusIndex ?? 0) + ',' + Math.min(this.slotCount(entry) - 1, (entry.focusIndex ?? 0) + 9),
          validateInput: value => {
            if (!/^\d+\s*[,，]\s*\d+$/.test(value.trim())) return '输入起始 ID,结束 ID';
            const [a, b] = value.split(/[,，]/).map(Number);
            return a <= b && b < this.slotCount(entry) && b - a < 256 ? undefined : 'ID 越界或超过 256 帧';
          } });
        if (value === undefined || !active()) return;
        const [a, b] = value.split(/[,，]/).map(Number);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= this.slotCount(entry) || b - a >= 256) throw new EditWorkerError('INVALID_INDEX');
        ids = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      } else {
        if (message.revision !== revision) throw new EditWorkerError('STALE_REVISION');
        ids = message.ids;
      }
      const frames: ResourceEditorSlot[] = [], decoded: AnimationFrame[] = [];
      let bytes = 0;
      for (const id of ids) {
        if (!active()) return;
        const slot = (await this.slots(entry, [id]))[0]; frames.push(slot);
        if (slot.status === 'empty') {
          if (message.type === 'exportAnimation') decoded.push({ image: { width: 1, height: 1, rgba: new Uint8ClampedArray(4) }, x: 0, y: 0 });
          continue;
        }
        if (!slot.imageUrl || slot.offsetX == null || slot.offsetY == null) throw new EditWorkerError('ANIMATION_METADATA_REQUIRED');
        bytes += slot.width! * slot.height! * 4;
        if (bytes > 64 * 1024 * 1024) throw new EditWorkerError('ANIMATION_MEMORY_LIMIT');
        if (message.type === 'exportAnimation') {
          const png = entry.editClient ? await entry.editClient.preview(id) : await vscode.workspace.fs.readFile(archiveResourceUri(entry.summary.archiveId, id));
          decoded.push({ image: decodeResourcePng(Buffer.from(png)), x: slot.offsetX, y: slot.offsetY });
        }
      }
      if (!active()) return;
      if (message.type === 'animation') {
        this.post(entry, { type: 'animationFrames', requestId: message.requestId, revision, frames }); return;
      }
      const picked = await vscode.window.showSaveDialog({ title: '导出无损 APNG 动画（不包含参照图）', filters: { APNG: ['apng'] } });
      if (!picked || picked.scheme !== 'file' || !active()) return;
      const output = await new Promise<Buffer>((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '..', 'resource-editor', 'animation-worker.js'), { workerData: { frames: decoded, fps: message.fps } });
        worker.once('message', reply => { void worker.terminate(); if (reply.error) reject(new EditWorkerError(reply.error)); else resolve(Buffer.from(reply.bytes)); });
        worker.once('error', () => reject(new EditWorkerError('ANIMATION_FAILED')));
        worker.once('exit', code => { if (code) reject(new EditWorkerError('ANIMATION_FAILED')); });
      });
      if (!active()) return;
      if (!entry.editInfo) this.current(entry);
      const target = path.join(fs.realpathSync(path.dirname(picked.fsPath)), path.basename(picked.fsPath));
      if (fs.existsSync(target)) throw new EditWorkerError('TARGET_EXISTS');
      const stage = path.join(path.dirname(target), '.boo-animation-' + crypto.randomBytes(16).toString('hex'));
      let created = false;
      try {
        const fd = fs.openSync(stage, 'wx'); created = true;
        try { fs.writeFileSync(fd, output); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.linkSync(stage, target);
      } finally { if (created) fs.unlinkSync(stage); }
      this.post(entry, { type: 'notice', text: 'APNG 已导出，保留透明度及固定原点。', busy: true });
    } catch (error) { this.editNotice(entry, error); }
    finally { entry.busy = false; this.post(entry, { type: 'busy', busy: false }); }
  }

  private async batchTools(entry: ResourcePanel, message: Extract<ResourceEditorMessage, { type: 'batchTools' }>, active: () => boolean): Promise<void> {
    const client = entry.editClient!, info = entry.editInfo!;
    const ids = message.ids.length ? message.ids : message.index === null ? [] : [message.index];
    const choices = [
      { label: '批量导入', id: 'import' },
      ...(ids.length ? [
        { label: '设置所选偏移', id: 'absolute' }, { label: '增减所选偏移', id: 'relative' },
        { label: '清空所选槽位', id: 'clear' }, { label: '复制所选图片', id: 'copy' },
        { label: '水平镜像', id: 'mirrorX' }, { label: '垂直镜像', id: 'mirrorY' },
        { label: '裁去透明边缘', id: 'trim' }, { label: '最近邻缩放', id: 'scale' },
      ] : []),
      ...(this.clipboard ? [{ label: '粘贴图片', id: 'paste' }] : []),
    ];
    const choice = await vscode.window.showQuickPick(choices, { title: '批量 / 图像工具', placeHolder: ids.length ? '已选 ' + ids.length + ' 个槽位' : '先多选素材可使用更多工具' });
    if (!choice || !active()) return;
    if (choice.id === 'copy') {
      this.clipboard = await client.copy(ids, info.revision);
      this.post(entry, { type: 'notice', text: '已复制 ' + this.clipboard.length + ' 张图片及偏移，可在其他工作台粘贴。', busy: true }); return;
    }
    let request: ResourceBatchRequest;
    if (choice.id === 'import') {
      const picked = await vscode.window.showOpenDialog({ title: '批量导入 PNG / BMP（最多 256 张）', canSelectMany: true, canSelectFiles: true, canSelectFolders: false, filters: { 'PNG / BMP': ['png', 'bmp'] } });
      if (!picked?.length || picked.some(uri => uri.scheme !== 'file') || !active()) return;
      const mapping = await vscode.window.showQuickPick([
        { label: '文件名作为 ID', id: 'filename' as const }, { label: '追加到末尾', id: 'append' as const },
        ...(message.index === null ? [] : [{ label: '从当前 ID 连续导入', id: 'sequential' as const }]),
      ], { title: '导入位置', placeHolder: '支持 123.png 或 Image_000123.png；连续导入按文件名自然排序' });
      if (!mapping || !active()) return;
      const paths = picked.map(uri => uri.fsPath).sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true }));
      request = { kind: 'import', paths, mapping: mapping.id, start: message.index ?? info.slotCount };
    } else if (choice.id === 'paste') {
      const where = await vscode.window.showQuickPick([
        { label: '追加到末尾', append: true },
        ...(message.index === null ? [] : [{ label: '从当前 ID 连续粘贴', append: false }]),
      ], { title: '粘贴位置（保留复制的偏移）' });
      if (!where || !active()) return;
      request = { kind: 'paste', frames: this.clipboard!, start: message.index ?? info.slotCount, append: where.append };
    } else if (choice.id === 'absolute' || choice.id === 'relative') {
      const value = await vscode.window.showInputBox({ title: choice.id === 'absolute' ? '设置偏移 X,Y' : '增减偏移 ΔX,ΔY', value: '0,0', ignoreFocusOut: true,
        validateInput: text => /^-?\d+\s*[,，]\s*-?\d+$/.test(text.trim()) && text.split(/[,，]/).every(v => Number(v) >= -32768 && Number(v) <= 32767) ? undefined : '输入两个 -32768 至 32767 的整数，以逗号分隔' });
      if (value === undefined || !active()) return;
      const [x, y] = value.split(/[,，]/).map(Number);
      request = { kind: 'offsets', ids, x, y, relative: choice.id === 'relative' };
    } else if (choice.id === 'clear') request = { kind: 'clear', ids };
    else if (choice.id === 'scale') {
      const value = await vscode.window.showInputBox({ title: '最近邻缩放百分比（1–800；偏移保持不变）', value: '100', ignoreFocusOut: true,
        validateInput: text => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 800 ? undefined : '输入 1–800 的整数' });
      if (value === undefined || !active()) return;
      request = { kind: 'transform', ids, transform: { kind: 'scale', percent: Number(value) } };
    } else request = { kind: 'transform', ids, transform: { kind: choice.id as 'mirrorX' | 'mirrorY' | 'trim' } };
    const controller = new AbortController(); entry.exportAbort = controller;
    try {
      this.post(entry, { type: 'notice', text: '正在预检整批操作…', busy: true, cancellable: true });
      const preview = await client.prepareBatch(request, info.revision, controller.signal);
      if (!active()) return;
      const labels: Record<string, string> = { replace: '替换', fill: '填空', append: '追加', offsets: '偏移', clear: '清空' };
      const detail = preview.rows.slice(0, 256).map(row => (row.name ? row.name + ' → ' : '') + 'ID ' + row.index + ' · ' + labels[row.action]).join('\n')
        + (preview.rows.length > 256 ? '\n另 ' + (preview.rows.length - 256) + ' 个槽位' : '')
        + '\n整批应用，可一步撤销；仅修改草稿。';
      const confirmation = await vscode.window.showInformationMessage('预检通过：' + preview.rows.length + ' 个槽位', { modal: true, detail }, '应用整批');
      if (confirmation !== '应用整批' || !active()) return;
      entry.editInfo = await client.applyBatch(info.revision, controller.signal);
      this.post(entry, { type: 'notice', text: '已应用整批操作，可一步撤销。', busy: true });
    } finally { entry.exportAbort = undefined; await client.cancelBatch(); }
  }

  private async saveEdit(entry: ResourcePanel, active = () => this.alive(entry)): Promise<boolean> {
    const client = entry.editClient, info = entry.editInfo;
    if (!client || !info) return false;
    const source = entry.savedTarget || entry.summary.pakPath;
    const suffix = info.profileId === 'gom-gameofmir2-v2' ? 'pak' : 'jpk', base = path.basename(source, path.extname(source));
    const picked = await vscode.window.showSaveDialog(info.saveMode === 'directory'
      ? { title: '另存资源组：输入新文件夹名称（内含数据和索引）', defaultUri: vscode.Uri.file(path.join(path.dirname(source), `${base}-edited`)) }
      : { title: `另存为新 ${suffix.toUpperCase()}（不覆盖现有文件）`, defaultUri: vscode.Uri.file(path.join(path.dirname(source), `${base}-edited.${suffix}`)), filters: { [suffix.toUpperCase()]: [suffix] } });
    if (!picked || picked.scheme !== 'file' || !active()) return false;
    this.post(entry, { type: 'notice', text: '正在构建并逐图核验新包…', busy: true });
    let result;
    try { result = await client.saveAs(picked.fsPath, info.revision); }
    catch (error) {
      if (error instanceof EditWorkerError && error.code.startsWith('PUBLISHED_')) {
        this.post(entry, { type: 'notice', text: '新包已生成，但保存后会话校验失败。当前仍保留原编辑会话，请检查新文件，不要重复覆盖。', busy: true });
      }
      throw error;
    }
    const savedPath = result.session.sourcePath;
    entry.editInfo = result.session; entry.savedTarget = savedPath; entry.indexUnavailable = true;
    this.clearDraftImages(entry);
    try {
      const opened = await openArchiveIndexed({ extensionPath: this.context.extensionPath, indexRoot: this.indexRoot,
        pakPath: savedPath, password: entry.password!, willIdx: entry.summary.storedWillIdx, forceRefresh: true });
      const summary = loadArchiveSummary(this.indexRoot, opened.archiveId!);
      if (summary.sourceSha256 !== result.targetSha256) throw new Error('Saved source changed');
      if (result.session.sourceCompanionSha256 && summary.companionSha256 !== result.session.sourceCompanionSha256) throw new Error('Saved companion changed');
      for (const [key, existing] of this.panels) if (existing === entry) this.panels.delete(key);
      entry.summary = summary; this.panels.set(summary.archiveId, entry); entry.indexUnavailable = false;
      if (!entry.disposed) this.updateRoots(entry);
    } catch { throw new EditWorkerError('SAVED_INDEX_FAILED'); }
    this.post(entry, { type: 'notice', text: '已另存新包并重新读取，原包未改动。', busy: true });
    return true;
  }

  private editNotice(entry: ResourcePanel, error: unknown): void {
    const code = error instanceof EditWorkerError ? error.code : 'EDIT_FAILED';
    const messages: Record<string, string> = {
      READONLY_JPK_PROFILE: '此 JPK 含未验证布局或额外数据，暂仅支持浏览/导出。',
      READONLY_GOM_PROFILE: '此 PAK 不是已验证的 GAMEOFMIR2 布局，或含额外数据，暂仅支持浏览/导出。',
      READONLY_ARCHIVE_PROFILE: '此格式尚未开放编辑，仍可浏览和导出。',
      READONLY_PAIR_PROFILE: '数据与索引不属于已验证的成对布局，暂仅支持浏览/导出。',
      PAIR_WINDOWS_ONLY: '成对资源组的安全另存目前仅支持 Windows。',
      SOURCE_CHANGED: '源包已被外部修改，本次操作已阻止，请保留草稿并重新核对。',
      CREDENTIAL_MISMATCH: '密码与当前缓存不一致，请确认密码或在补丁管理重载。',
      TARGET_EXISTS: '目标已存在，请选择新的文件名；不会覆盖现有文件。',
      SOURCE_OVERWRITE_DISABLED: '不能覆盖源包，请另存为新文件。',
      SAVED_INDEX_FAILED: '新包已保存，但索引重建失败。可保留编辑会话或在补丁管理重载新包。',
      PUBLISHED_REVALIDATION_FAILED: '新包已生成，但保存后校验失败，请检查新文件。',
      OFFSET_RANGE: '偏移必须是 -32768 到 32767 之间的整数。',
      EDIT_MEMORY_LIMIT: '草稿达到内存上限，请先另存，再继续编辑。',
      PIXEL_NOT_REPRESENTABLE: '原槽位无法无损表示此图片的颜色或透明度，导入已拒绝。',
      ATOMIC_PUBLICATION_UNAVAILABLE: '目标文件系统不支持安全发布，请选择本地 NTFS 目录；原包未改动。',
      UNSUPPORTED_PNG_LAYOUT: '暂不支持此 PNG 的位深或交错方式，请使用 8 位非交错 PNG。',
      UNSUPPORTED_BMP_ALPHA: '此 BMP 的透明通道含义不明确，请改用 PNG。',
      IMAGE_MEMORY_LIMIT: '图片解码超过内存限制，请缩小图片后重试。',
      IMAGE_DIMENSIONS: '图片尺寸超出支持范围，请缩小图片后重试。',
      JPK_DIMENSIONS: '此 JPK 不支持宽高都不超过 2 像素的图片，请使用更大的图片。',
      WORKER_EXIT: '编辑工作线程退出，请检查最近另存的文件；原包未被覆盖。',
      STALE_REVISION: '草稿已更新，请在刷新后重试。',
      CANCELLED: '已取消本批操作，草稿保持原样。',
      BATCH_MEMORY_LIMIT: '本批解码图片超过 64 MiB，请分批处理。',
      BATCH_LIMIT: '一批最多处理 256 张图片。',
      DUPLICATE_ID: '多个文件映射到了相同 ID，整批未应用。',
      FILENAME_ID_REQUIRED: '请使用 123.png 或 Image_000123.png 这样的编号文件名。',
      INVALID_INDEX: '目标 ID 越界或不连续，整批未应用。',
      EMPTY_SLOT: '选择中含空槽，请仅选择有图的槽位。',
      ANIMATION_METADATA_REQUIRED: '动画中存在坏槽或未知偏移，无法可靠对齐。',
      ANIMATION_MEMORY_LIMIT: '动画范围或画布超过 64 MiB 限制，请缩小帧范围。',
    };
    entry.notice = messages[code] || `编辑未完成（${code}），原包未改动。`;
    this.post(entry, { type: 'notice', text: entry.notice, busy: entry.busy });
  }

  private async drainInspections(entry: ResourcePanel): Promise<void> {
    if (entry.inspecting) return;
    entry.inspecting = true;
    try {
      while (this.alive(entry) && entry.inspectRequest) {
        const request = entry.inspectRequest;
        const revision = entry.editInfo?.revision ?? 0;
        try {
          const slot = (await this.slots(entry, [request.index]))[0];
          if (slot.imageUrl && !entry.editInfo) await vscode.workspace.fs.readFile(archiveResourceUri(entry.summary.archiveId, request.index));
          if (entry.inspectRequest === request && entry.documentId === request.documentId && revision === (entry.editInfo?.revision ?? 0)) {
            this.post(entry, { type: 'detail', requestId: request.requestId, editRevision: revision,
              slot: entry.editInfo ? slot : (await this.slots(entry, [request.index]))[0] });
          }
        } catch {
          if (entry.inspectRequest === request && entry.documentId === request.documentId && revision === (entry.editInfo?.revision ?? 0)) {
            try {
              const slot = (await this.slots(entry, [request.index]))[0];
              if (entry.inspectRequest !== request || entry.documentId !== request.documentId || revision !== (entry.editInfo?.revision ?? 0)) continue;
              this.post(entry, { type: 'detail', requestId: request.requestId, editRevision: revision, slot: { ...slot, imageUrl: undefined } });
            } catch { /* Stale source is not an image corruption verdict. */ }
            if (entry.inspectRequest === request && entry.documentId === request.documentId && revision === (entry.editInfo?.revision ?? 0)) {
              this.post(entry, { type: 'notice', text: '当前图片无法读取，请检查素材或重载资源包。', busy: entry.busy });
            }
          }
        }
        if (entry.inspectRequest === request) entry.inspectRequest = undefined;
      }
    } finally { entry.inspecting = false; }
  }

  private async exportImages(entry: ResourcePanel, selection: ArchiveExportSelection, documentId: string): Promise<void> {
    const controller = new AbortController();
    entry.exportAbort = controller;
    entry.busy = true;
    this.post(entry, { type: 'notice', text: '选择导出目录…', busy: true });
    try {
      const picked = await vscode.window.showOpenDialog({ title: '导出 PNG 与坐标清单（创建独立子目录）',
        openLabel: '导出到此目录', canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
      if (!picked?.[0] || !this.alive(entry) || entry.documentId !== documentId || controller.signal.aborted) return;
      if (picked[0].scheme !== 'file') throw new Error('仅支持本地目录');
      this.current(entry);
      this.post(entry, { type: 'notice', text: '正在核对源文件并导出…', busy: true });
      const result = await exportArchiveImages({ extensionPath: this.context.extensionPath, indexRoot: this.indexRoot,
        archiveId: entry.summary.archiveId, indexGeneration: entry.summary.indexGeneration,
        destinationParent: picked[0].fsPath, selection, signal: controller.signal,
        onProgress: progress => this.post(entry, { type: 'progress', ...progress }) });
      if (!this.alive(entry)) return;
      const text = result.state === 'complete' ? `导出完成：${result.exported} 张图片。`
        : result.state === 'cancelled' ? `已取消：已导出 ${result.exported} 张，清单标记为未完成。`
          : `部分导出：${result.exported} 张，失败 ${result.failed} 项，请查看清单。`;
      this.post(entry, { type: 'notice', text, busy: false });
      void vscode.window.showInformationMessage(text, '打开导出目录').then(chosen => {
        if (chosen === '打开导出目录') return vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.manifestPath));
        return undefined;
      }, () => undefined);
    } catch {
      if (this.alive(entry)) this.post(entry, { type: 'notice', text: '导出未完成，请检查源文件、目标目录或磁盘空间。未修改原包。', busy: false });
    } finally {
      if (entry.exportAbort === controller) {
        entry.exportAbort = undefined;
        const wasBusy = entry.busy;
        entry.busy = false;
        // Cancelling a picker has no export result; always release disabled UI controls.
        if (wasBusy && this.alive(entry)) this.post(entry, { type: 'busy', busy: false });
      }
    }
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
