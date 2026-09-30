import * as path from 'path';
import * as vscode from 'vscode';
import { formatVariableGroupLabel } from '../utils/variable-statistics';
import { isVariableListFile, VariableListOptions, VariableListScanner, VariableListSnapshot } from '../utils/variable-list';

interface VariableListProviderOptions extends VariableListOptions {
  workspaceState: vscode.Memento;
  publish: (snapshot: VariableListSnapshot) => void;
  log: (message: string) => void;
  invalidateDependencies: () => void;
}
class VariableListItem extends vscode.TreeItem {
  children?: VariableListItem[];
}

export class VariableListProvider implements vscode.TreeDataProvider<VariableListItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<VariableListItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly scanner: VariableListScanner;
  private cached?: VariableListItem[];
  private pending?: Promise<VariableListItem[]>;
  private timer?: ReturnType<typeof setTimeout>;
  private needsScan = true;
  private revision = 0;
  private disposed = false;
  constructor(private readonly options: VariableListProviderOptions) { this.scanner = new VariableListScanner(options); }
  getTreeItem(item: VariableListItem): vscode.TreeItem { return item; }
  refresh(): void { if (!this.disposed) this.emitter.fire(); }
  /** Manual refresh/M2 reload must also invalidate dependency and analysis caches. */
  clearCache(): void { this.invalidate(undefined, true); }
  resetWorkspace(): void {
    this.cached = undefined;
    this.invalidate(undefined, true);
  }
  invalidate(file?: string, immediate = false): void {
    if (this.disposed) return;
    this.revision++;
    this.needsScan = true;
    this.scanner.invalidate(file);
    this.options.invalidateDependencies();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (immediate) this.refresh();
    else this.timer = setTimeout(() => { this.timer = undefined; this.refresh(); }, 350);
  }
  getChildren(item?: VariableListItem): VariableListItem[] | Promise<VariableListItem[]> {
    if (item) return item.children || [];
    if (this.disposed) return [];
    if (this.cached && !this.needsScan) return this.cached;
    if (this.pending) return this.cached || this.pending;
    const revision = this.revision;
    const hadCached = !!this.cached;
    const roots = (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath);
    // Refresh follows saved content. Drafts stay out even when another file is saved.
    const documents = vscode.workspace.textDocuments.filter(doc => !doc.isDirty && doc.uri.scheme === 'file' && isVariableListFile(doc.uri.fsPath))
      .map(doc => ({ filePath: doc.uri.fsPath, text: doc.getText() }));
    this.pending = this.scanner.scan(roots, documents, () => this.disposed || revision !== this.revision)
      .then(snapshot => {
        if (!snapshot || this.disposed || revision !== this.revision) return this.disposed ? [] : this.cached || [];
        this.options.publish(snapshot);
        for (const error of snapshot.errors) this.options.log(`变量扫描跳过: ${error}`);
        const items = this.buildItems(snapshot);
        if (!roots.length) items.push(new VariableListItem('(未打开工作区)', vscode.TreeItemCollapsibleState.None));
        else if (!items.length) items.push(new VariableListItem(snapshot.errors.length ? '(部分文件读取失败，请查看输出)' : '(未发现变量)', vscode.TreeItemCollapsibleState.None));
        else if (snapshot.errors.length) items.push(new VariableListItem('(部分文件读取失败，请查看输出)', vscode.TreeItemCollapsibleState.None));
        this.cached = items;
        this.needsScan = false;
        return items;
      }).catch(error => {
        if (this.disposed || revision !== this.revision) return this.disposed ? [] : this.cached || [];
        this.options.log(`变量扫描失败: ${String(error)}`);
        this.needsScan = false;
        return this.cached ||= [new VariableListItem('(变量扫描失败，请查看输出)', vscode.TreeItemCollapsibleState.None)];
      }).finally(() => {
        this.pending = undefined;
        // Never let a late result resurrect an old workspace or an old document.
        if (!this.disposed && revision !== this.revision && !this.timer) this.refresh();
        else if (!this.disposed && revision === this.revision && hadCached) this.refresh();
      });
    // An existing list remains interactive until a complete replacement is ready.
    return this.cached || this.pending;
  }
  private buildItems(snapshot: VariableListSnapshot): VariableListItem[] {
    const descriptions = this.options.workspaceState.get<Record<string, string>>('boo.varDescs', {});
    const groups = new Map<string, VariableListItem[]>();
    for (const [name, info] of snapshot.usages) {
      const files = [...info.files];
      const displayFiles = files.slice(0, 3).map(file => vscode.workspace.asRelativePath(file, true)).join(',');
      const item = new VariableListItem(name, vscode.TreeItemCollapsibleState.None);
      item.id = `variable:${name}`;
      item.description = descriptions[name] || `${info.count}次 [${displayFiles}${files.length > 3 ? '...' : ''}]`;
      item.tooltip = `${descriptions[name] ? descriptions[name] + '\n' : ''}${info.count}次 · ${files.length}个文件\n${files.join('\n')}\n点击跳转，再次点击循环`;
      item.iconPath = new vscode.ThemeIcon(descriptions[name] ? 'bookmark' : 'symbol-variable');
      item.command = { command: 'boo.gotoVarOccurrence', title: '跳转', arguments: [name] };
      const children = groups.get(info.type) || [];
      children.push(item);
      groups.set(info.type, children);
    }
    return [...groups].map(([type, children]) => {
      children.sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-CN', { numeric: true }));
      const group = new VariableListItem(formatVariableGroupLabel(type, children.length), vscode.TreeItemCollapsibleState.Collapsed);
      group.id = `variable-group:${type}`;
      group.children = children;
      group.iconPath = new vscode.ThemeIcon('folder');
      return group;
    });
  }
  dispose(): void {
    this.disposed = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    this.scanner.invalidate();
    this.emitter.dispose();
  }
}

/** Refresh after saves/explicit file operations; editor activity and disk churn keep the list visible. */
export function registerVariableListRefresh(context: vscode.ExtensionContext, provider: VariableListProvider): void {
  const relevant = (uri: vscode.Uri) => uri.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(uri);
  const change = (uri: vscode.Uri) => {
    if (!relevant(uri) || !/\.(txt|ini|csv|xlsx?)$/i.test(uri.fsPath)) return;
    // MapInfo changes alter map-code exclusions in every script.
    provider.invalidate(/^mapinfo\.txt$/i.test(path.basename(uri.fsPath)) ? undefined : uri.fsPath);
  };
  context.subscriptions.push(provider,
    vscode.workspace.onDidSaveTextDocument(doc => change(doc.uri)),
    vscode.workspace.onDidCreateFiles(event => { if (event.files.some(relevant)) provider.invalidate(); }),
    vscode.workspace.onDidDeleteFiles(event => { if (event.files.some(relevant)) provider.invalidate(); }),
    vscode.workspace.onDidRenameFiles(event => { if (event.files.some(file => relevant(file.oldUri) || relevant(file.newUri))) provider.invalidate(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.resetWorkspace())
  );
}
