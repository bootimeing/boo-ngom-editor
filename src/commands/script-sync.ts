import * as path from 'path';
import * as vscode from 'vscode';
import {
  listScriptSyncDirectory,
  validateScriptSyncSources,
  validateScriptSyncTargets,
} from '../utils/script-sync-tree';
import { secureWebviewHtml } from '../utils/webview-security';

export const OPEN_SCRIPT_SYNC_COMMAND_ID = 'boo.openScriptSync';
const TARGET_ROOTS_STATE_KEY = 'boo.zoneSync.targetRoots';

export type ScriptSyncRunner = (
  workspaceRoot: string,
  sourcePaths: readonly string[],
  targetRoots: readonly string[]
) => Promise<void>;

interface ScriptSyncMessage {
  type?: unknown;
  side?: unknown;
  directoryPath?: unknown;
  requestId?: unknown;
  sourcePaths?: unknown;
  targetRoots?: unknown;
}

export function registerScriptSyncCommand(
  context: vscode.ExtensionContext,
  runSync: ScriptSyncRunner
): vscode.Disposable {
  let currentPanel: ScriptSyncPanel | undefined;
  const command = vscode.commands.registerCommand(OPEN_SCRIPT_SYNC_COMMAND_ID, () => {
    const selectedWorkspaceRoot = currentWorkspaceRoot();
    if (!selectedWorkspaceRoot) {
      vscode.window.showWarningMessage('请先打开一个服务端工作区');
      return;
    }
    const workspaceRoot = path.resolve(selectedWorkspaceRoot);
    if (currentPanel?.workspaceRoot === workspaceRoot) {
      currentPanel.reveal();
      return;
    }
    currentPanel?.dispose();
    currentPanel = new ScriptSyncPanel(
      context,
      workspaceRoot,
      runSync,
      () => { currentPanel = undefined; }
    );
  });
  return vscode.Disposable.from(command, { dispose: () => currentPanel?.dispose() });
}

class ScriptSyncPanel {
  readonly workspaceRoot: string;
  private readonly driveRoot: string;
  private readonly panel: vscode.WebviewPanel;
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    workspaceRoot: string,
    private readonly runSync: ScriptSyncRunner,
    onDispose: () => void
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.driveRoot = path.parse(this.workspaceRoot).root;
    this.panel = vscode.window.createWebviewPanel(
      'booScriptSync',
      `脚本同步 - ${path.basename(this.workspaceRoot)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    this.panel.webview.html = secureWebviewHtml(
      this.panel.webview,
      scriptSyncHtml(),
      { enableScripts: true }
    );
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message as ScriptSyncMessage);
    });
    this.panel.onDidDispose(onDispose);
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  dispose(): void {
    this.panel.dispose();
  }

  private async handleMessage(message: ScriptSyncMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.initializeWebview();
      return;
    }
    if (message.type === 'listDirectory') {
      await this.listDirectory(message);
      return;
    }
    if (message.type === 'startSync') {
      await this.startSync(message);
      return;
    }
    if (message.type === 'close') this.dispose();
  }

  private async initializeWebview(): Promise<void> {
    const remembered = this.context.workspaceState.get<string[]>(TARGET_ROOTS_STATE_KEY, []);
    const rememberedTargets: string[] = [];
    for (const candidate of remembered) {
      try {
        rememberedTargets.push(...await validateScriptSyncTargets(this.driveRoot, [candidate]));
      } catch {
        // Stale or cross-drive target from an older workspace.
      }
    }
    await this.panel.webview.postMessage({
      type: 'initialize',
      workspaceRoot: this.workspaceRoot,
      workspaceName: path.basename(this.workspaceRoot) || this.workspaceRoot,
      driveRoot: this.driveRoot,
      rememberedTargets,
    });
  }

  private async listDirectory(message: ScriptSyncMessage): Promise<void> {
    const side = message.side === 'source' || message.side === 'target'
      ? message.side
      : undefined;
    const directoryPath = typeof message.directoryPath === 'string'
      ? message.directoryPath
      : undefined;
    const requestId = typeof message.requestId === 'number'
      ? message.requestId
      : undefined;
    if (!side || !directoryPath || requestId === undefined) return;

    try {
      const entries = await listScriptSyncDirectory(
        side === 'source' ? this.workspaceRoot : this.driveRoot,
        directoryPath,
        side === 'source'
      );
      await this.panel.webview.postMessage({
        type: 'directoryResult',
        requestId,
        side,
        directoryPath,
        entries,
      });
    } catch (error) {
      await this.panel.webview.postMessage({
        type: 'directoryResult',
        requestId,
        side,
        directoryPath,
        entries: [],
        error: errorText(error),
      });
    }
  }

  private async startSync(message: ScriptSyncMessage): Promise<void> {
    if (this.busy) return;
    try {
      const sourcePaths = await validateScriptSyncSources(
        this.workspaceRoot,
        stringArray(message.sourcePaths)
      );
      const targetRoots = await validateScriptSyncTargets(
        this.driveRoot,
        stringArray(message.targetRoots)
      );
      if (sourcePaths.length === 0) {
        vscode.window.showWarningMessage('请至少勾选一个要同步的文件或文件夹');
        await this.postStatus('请勾选同步来源', 'warning');
        return;
      }
      if (targetRoots.length === 0) {
        vscode.window.showWarningMessage('请至少勾选一个其他区的服务端根目录');
        await this.postStatus('请勾选同步目标', 'warning');
        return;
      }

      this.busy = true;
      await this.panel.webview.postMessage({ type: 'syncState', busy: true });
      await this.runSync(this.workspaceRoot, sourcePaths, targetRoots);
      await this.postStatus('同步操作已结束', 'normal');
    } catch (error) {
      const messageText = errorText(error);
      vscode.window.showErrorMessage(`脚本同步失败: ${messageText}`);
      await this.postStatus(messageText, 'error');
    } finally {
      this.busy = false;
      await this.panel.webview.postMessage({ type: 'syncState', busy: false });
    }
  }

  private async postStatus(message: string, tone: string): Promise<void> {
    await this.panel.webview.postMessage({ type: 'status', message, tone });
  }
}

function currentWorkspaceRoot(): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  return activeFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scriptSyncHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>脚本同步</title>
  <style>
    *{box-sizing:border-box}
    html,body{height:100%;margin:0}
    body{display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:13px var(--vscode-font-family)}
    button,input{font:inherit}
    button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid transparent;cursor:pointer}
    button:hover{background:var(--vscode-button-hoverBackground)}
    button:disabled{cursor:default;opacity:.55}
    .topbar{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 14px;border-bottom:1px solid var(--vscode-panel-border)}
    .title{font-size:16px;font-weight:600;white-space:nowrap}
    .workspace-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground)}
    .icon-button{width:28px;height:28px;padding:0;border-radius:3px;background:transparent;color:var(--vscode-foreground);font-size:18px}
    .topbar .icon-button{margin-left:auto}
    .panes{display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);min-height:0}
    .pane{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);min-width:0;min-height:0}
    .pane+.pane{border-left:1px solid var(--vscode-panel-border)}
    .pane-header{display:flex;align-items:center;gap:8px;min-height:42px;padding:6px 12px;border-bottom:1px solid var(--vscode-panel-border)}
    .pane-title{font-size:13px;font-weight:600}
    .count{color:var(--vscode-descriptionForeground)}
    .clear{margin-left:auto;padding:3px 8px;border:0;background:transparent;color:var(--vscode-textLink-foreground)}
    .root-path{padding:5px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);font-size:12px}
    .selection-summary{height:27px;padding:5px 12px;overflow:auto hidden;white-space:nowrap;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border);font-size:12px}
    .tree{min-height:0;overflow:auto;padding:4px 0}
    .tree-row{display:flex;align-items:center;height:27px;padding-right:8px;white-space:nowrap;user-select:none}
    .tree-row:hover{background:var(--vscode-list-hoverBackground)}
    .tree-row.selected{background:var(--vscode-list-inactiveSelectionBackground)}
    .tree-row input{width:15px;height:15px;margin:0 7px 0 2px;accent-color:var(--vscode-focusBorder)}
    .expander,.spacer{width:22px;height:24px;flex:0 0 22px;padding:0;border:0;background:transparent;color:var(--vscode-foreground)}
    .expander:hover{background:var(--vscode-toolbar-hoverBackground)}
    .name{overflow:hidden;text-overflow:ellipsis}
    .folder .name{font-weight:500}
    .children{display:none}
    .children.open{display:block}
    .load-state{padding:5px 12px;color:var(--vscode-descriptionForeground);font-size:12px}
    .load-state.error{color:var(--vscode-errorForeground)}
    .actions{display:flex;align-items:center;gap:8px;min-height:52px;padding:8px 14px;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}
    .status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground)}
    .status.warning{color:var(--vscode-editorWarning-foreground)}
    .status.error{color:var(--vscode-errorForeground)}
    .actions .close{margin-left:auto;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:6px 12px}
    .actions .close:hover{background:var(--vscode-button-secondaryHoverBackground)}
    .actions .sync{padding:6px 14px}
    @media(max-width:720px){.panes{grid-template-columns:1fr;grid-template-rows:minmax(240px,1fr) minmax(240px,1fr)}.pane+.pane{border-left:0;border-top:1px solid var(--vscode-panel-border)}}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="title">脚本同步</div>
    <div class="workspace-name" id="workspaceName"></div>
    <button class="icon-button" id="refresh" title="重新读取目录" aria-label="重新读取目录">&#x21bb;</button>
  </header>
  <main class="panes">
    <section class="pane">
      <div class="pane-header"><span class="pane-title">当前工作区</span><span class="count" id="sourceCount">已选 0 项</span><button class="clear" id="clearSource">清空</button></div>
      <div class="root-path" id="sourceRoot"></div>
      <div class="selection-summary" id="sourceSelection">未选择</div>
      <div class="tree" id="sourceTree"></div>
    </section>
    <section class="pane">
      <div class="pane-header"><span class="pane-title">同步目标</span><span class="count" id="targetCount">已选 0 项</span><button class="clear" id="clearTarget">清空</button></div>
      <div class="root-path" id="targetRoot"></div>
      <div class="selection-summary" id="targetSelection">未选择</div>
      <div class="tree" id="targetTree"></div>
    </section>
  </main>
  <footer class="actions">
    <div class="status" id="status">等待选择</div>
    <button class="close" id="close">关闭</button>
    <button class="sync" id="sync">开始同步</button>
  </footer>
  <script>
    const vscode = acquireVsCodeApi();
    const selected = { source: new Set(), target: new Set() };
    const pending = new Map();
    let requestId = 0;
    let roots;
    let busy = false;

    const byId = id => document.getElementById(id);
    const setStatus = (message, tone = 'normal') => {
      const status = byId('status');
      status.textContent = message;
      status.className = 'status' + (tone === 'normal' ? '' : ' ' + tone);
    };
    const updateCounts = () => {
      byId('sourceCount').textContent = '已选 ' + selected.source.size + ' 项';
      byId('targetCount').textContent = '已选 ' + selected.target.size + ' 项';
      const sourceText = [...selected.source].join('  |  ') || '未选择';
      const targetText = [...selected.target].join('  |  ') || '未选择';
      byId('sourceSelection').textContent = sourceText;
      byId('sourceSelection').title = sourceText;
      byId('targetSelection').textContent = targetText;
      byId('targetSelection').title = targetText;
      document.querySelectorAll('.tree-row[data-side]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        checkbox.checked = selected[row.dataset.side].has(row.dataset.path);
        row.classList.toggle('selected', checkbox.checked);
      });
    };

    const requestDirectory = (side, directoryPath, children, expander) => {
      const id = ++requestId;
      pending.set(id, { side, directoryPath, children, expander });
      children.replaceChildren(loadState('正在读取...'));
      vscode.postMessage({ type: 'listDirectory', requestId: id, side, directoryPath });
    };
    const loadState = (text, error = false) => {
      const element = document.createElement('div');
      element.className = 'load-state' + (error ? ' error' : '');
      element.textContent = text;
      return element;
    };
    const createNode = (side, entry, depth, isRoot = false) => {
      const node = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'tree-row' + (entry.isDirectory ? ' folder' : '');
      row.style.paddingLeft = (depth * 16 + 4) + 'px';
      row.dataset.side = side;
      row.dataset.path = entry.entryPath;

      let children;
      let expander;
      if (entry.isDirectory) {
        expander = document.createElement('button');
        expander.className = 'expander';
        expander.textContent = isRoot ? '\u25be' : '\u203a';
        expander.title = '展开文件夹';
        row.appendChild(expander);
        children = document.createElement('div');
        children.className = 'children' + (isRoot ? ' open' : '');
        expander.addEventListener('click', () => {
          const opening = !children.classList.contains('open');
          children.classList.toggle('open', opening);
          expander.textContent = opening ? '\u25be' : '\u203a';
          if (opening && !children.dataset.loaded) {
            requestDirectory(side, entry.entryPath, children, expander);
          }
        });
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        row.appendChild(spacer);
      }

      if (!(side === 'target' && isRoot)) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected[side].has(entry.entryPath);
        checkbox.setAttribute('aria-label', '选择 ' + entry.name);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected[side].add(entry.entryPath);
          else selected[side].delete(entry.entryPath);
          updateCounts();
        });
        row.appendChild(checkbox);
      }

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name;
      name.title = entry.entryPath;
      row.appendChild(name);
      node.appendChild(row);
      if (children) node.appendChild(children);
      if (isRoot && children) requestDirectory(side, entry.entryPath, children, expander);
      return node;
    };

    const renderDirectory = (request, entries, error) => {
      request.children.dataset.loaded = 'true';
      request.children.replaceChildren();
      if (error) {
        request.children.appendChild(loadState(error, true));
        return;
      }
      if (!entries.length) {
        request.children.appendChild(loadState('空文件夹'));
        return;
      }
      const parentRow = request.children.parentElement.querySelector(':scope > .tree-row');
      const depth = parentRow ? Math.round((parseInt(parentRow.style.paddingLeft, 10) - 4) / 16) + 1 : 1;
      for (const entry of entries) request.children.appendChild(createNode(request.side, entry, depth));
      updateCounts();
    };

    const renderRoots = () => {
      pending.clear();
      byId('sourceTree').replaceChildren(createNode('source', {
        name: roots.workspaceName,
        entryPath: roots.workspaceRoot,
        isDirectory: true,
      }, 0, true));
      byId('targetTree').replaceChildren(createNode('target', {
        name: roots.driveRoot,
        entryPath: roots.driveRoot,
        isDirectory: true,
      }, 0, true));
      updateCounts();
    };

    byId('clearSource').addEventListener('click', () => { selected.source.clear(); updateCounts(); });
    byId('clearTarget').addEventListener('click', () => { selected.target.clear(); updateCounts(); });
    byId('refresh').addEventListener('click', () => { if (roots && !busy) renderRoots(); });
    byId('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    byId('sync').addEventListener('click', () => {
      if (busy) return;
      vscode.postMessage({
        type: 'startSync',
        sourcePaths: [...selected.source],
        targetRoots: [...selected.target],
      });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'initialize') {
        roots = message;
        selected.target = new Set(message.rememberedTargets || []);
        byId('workspaceName').textContent = message.workspaceName;
        byId('sourceRoot').textContent = message.workspaceRoot;
        byId('targetRoot').textContent = message.driveRoot;
        renderRoots();
      } else if (message.type === 'directoryResult') {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        renderDirectory(request, message.entries || [], message.error);
      } else if (message.type === 'syncState') {
        busy = Boolean(message.busy);
        byId('sync').disabled = busy;
        byId('refresh').disabled = busy;
        byId('sync').textContent = busy ? '正在同步...' : '开始同步';
        if (busy) setStatus('正在同步', 'normal');
      } else if (message.type === 'status') {
        setStatus(message.message || '', message.tone || 'normal');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
