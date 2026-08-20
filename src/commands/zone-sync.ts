import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  collectZoneSyncInventory,
  executeZoneSync,
  validateZoneSyncTargets,
  ZoneSyncCancelledError,
  ZoneSyncInventory,
  ZoneSyncResult,
} from '../utils/zone-sync';
import { registerScriptSyncCommand } from './script-sync';

const COMMAND_ID = 'boo.syncToOtherZones';
const TARGET_ROOTS_STATE_KEY = 'boo.zoneSync.targetRoots';

interface DirectoryTargetItem extends vscode.QuickPickItem {
  directoryPath: string;
}

export function registerZoneSyncCommand(context: vscode.ExtensionContext): vscode.Disposable {
  const output = vscode.window.createOutputChannel('BOO 区服同步');
  const command = vscode.commands.registerCommand(
    COMMAND_ID,
    async (resource: unknown, selectedResources: unknown) => {
      await runZoneSync(context, output, resource, selectedResources);
    }
  );
  const scriptSyncCommand = registerScriptSyncCommand(
    context,
    (workspaceRoot, sourcePaths, targetRoots) => runZoneSyncSelection(
      context,
      output,
      workspaceRoot,
      sourcePaths,
      targetRoots
    )
  );
  return vscode.Disposable.from(output, command, scriptSyncCommand);
}

async function runZoneSync(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  resource: unknown,
  selectedResources: unknown
): Promise<void> {
  const resources = explorerResources(resource, selectedResources);
  if (resources.length === 0) {
    vscode.window.showWarningMessage('请先在资源管理器中选择要同步的文件或文件夹');
    return;
  }

  const workspaceFolders = resources.map(uri => vscode.workspace.getWorkspaceFolder(uri));
  if (workspaceFolders.some(folder => !folder)) {
    vscode.window.showWarningMessage('所选文件必须位于当前工作区根目录内');
    return;
  }
  const workspaceRootKeys = new Set(workspaceFolders.map(folder => pathKey(folder!.uri.fsPath)));
  if (workspaceRootKeys.size !== 1) {
    vscode.window.showWarningMessage('一次只能同步同一个工作区根目录内的文件和文件夹');
    return;
  }
  const workspaceRoot = workspaceFolders[0]!.uri.fsPath;
  const driveRoot = path.parse(workspaceRoot).root;
  const rememberedTargets = context.workspaceState
    .get<string[]>(TARGET_ROOTS_STATE_KEY, [])
    .filter(target => isExistingDirectory(target) && sameRoot(target, driveRoot));
  const targetRoots = await pickTargetRoots(driveRoot, rememberedTargets);
  if (!targetRoots) return;

  await runZoneSyncSelection(
    context,
    output,
    workspaceRoot,
    resources.map(uri => uri.fsPath),
    targetRoots
  );
}

export async function runZoneSyncSelection(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  workspaceRoot: string,
  sourcePaths: readonly string[],
  targetRoots: readonly string[]
): Promise<void> {
  if (sourcePaths.length === 0) {
    vscode.window.showWarningMessage('请至少勾选一个要同步的文件或文件夹');
    return;
  }

  let validatedTargets: string[];
  try {
    validatedTargets = validateZoneSyncTargets(workspaceRoot, targetRoots);
  } catch (error) {
    vscode.window.showErrorMessage(errorText(error));
    return;
  }
  if (validatedTargets.length === 0) {
    vscode.window.showWarningMessage('请至少勾选一个其他区的服务端根目录');
    return;
  }
  await context.workspaceState.update(TARGET_ROOTS_STATE_KEY, validatedTargets);

  let inventory: ZoneSyncInventory;
  try {
    inventory = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在整理区服同步文件',
        cancellable: true,
      },
      async (progress, token) => collectZoneSyncInventory(
        workspaceRoot,
        sourcePaths,
        {
          isCancelled: () => token.isCancellationRequested,
          onProgress: (visited, currentPath) => {
            if (visited === 1 || visited % 50 === 0) {
              progress.report({
                message: `${visited} 项 · ${displayRelativePath(workspaceRoot, currentPath)}`,
              });
            }
          },
        }
      )
    );
  } catch (error) {
    if (error instanceof ZoneSyncCancelledError) return;
    vscode.window.showErrorMessage(`整理同步文件失败: ${errorText(error)}`);
    return;
  }

  if (inventory.files.length === 0 && inventory.directories.length === 0) {
    vscode.window.showWarningMessage('所选内容中没有可同步的文件或文件夹');
    return;
  }
  const fileOperations = inventory.files.length * validatedTargets.length;
  const directoryOperations = inventory.directories.length * validatedTargets.length;
  const confirmation = await vscode.window.showWarningMessage(
    '确认同步到其他区？',
    {
      modal: true,
      detail: [
        `来源根目录：${workspaceRoot}`,
        `文件：${inventory.files.length} 个，文件夹：${inventory.directories.length} 个`,
        `目标区：${validatedTargets.length} 个，文件同步次数：${fileOperations} 次`,
        `目录创建/合并次数：${directoryOperations} 次`,
        '同路径文件将被覆盖，目标缺少的目录和文件会自动创建。',
        ...validatedTargets.slice(0, 8).map(target => `• ${target}`),
        ...(validatedTargets.length > 8 ? [`• 另有 ${validatedTargets.length - 8} 个目标区`] : []),
      ].join('\n'),
    },
    '确认同步'
  );
  if (confirmation !== '确认同步') return;

  output.appendLine('');
  output.appendLine(`[${new Date().toLocaleString()}] 开始同步`);
  output.appendLine(`来源: ${workspaceRoot}`);
  output.appendLine(`文件 ${inventory.files.length} 个，文件夹 ${inventory.directories.length} 个`);
  for (const target of validatedTargets) output.appendLine(`目标: ${target}`);
  if (inventory.skippedSymbolicLinks.length > 0) {
    output.appendLine(`跳过符号链接 ${inventory.skippedSymbolicLinks.length} 个:`);
    for (const skipped of inventory.skippedSymbolicLinks) output.appendLine(`  ${skipped}`);
  }

  const result = await runSyncWithProgress(inventory, validatedTargets);
  writeSyncResult(output, result);
  if (result.cancelled) {
    const message = `同步已取消：完成 ${result.completedOperations}/${result.totalOperations} 次文件同步`;
    const action = await vscode.window.showWarningMessage(message, '查看详情');
    if (action === '查看详情') output.show(true);
    return;
  }
  if (result.failures.length > 0) {
    const message = `同步完成：成功 ${result.copiedFiles} 次，失败 ${result.failures.length} 次`;
    const action = await vscode.window.showWarningMessage(message, '查看详情');
    if (action === '查看详情') output.show(true);
    return;
  }
  const skippedText = inventory.skippedSymbolicLinks.length > 0
    ? `，跳过 ${inventory.skippedSymbolicLinks.length} 个符号链接`
    : '';
  vscode.window.showInformationMessage(
    `同步完成：覆盖 ${result.overwrittenFiles} 个，新建 ${result.createdFiles} 个文件${skippedText}`
  );
}

async function runSyncWithProgress(
  inventory: ZoneSyncInventory,
  targetRoots: readonly string[]
): Promise<ZoneSyncResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '正在同步其他区',
      cancellable: true,
    },
    async (progress, token) => {
      let reportedPercent = 0;
      return executeZoneSync(inventory, targetRoots, {
        isCancelled: () => token.isCancellationRequested,
        onProgress: state => {
          const percent = state.total > 0 ? state.completed / state.total * 100 : 100;
          progress.report({
            increment: Math.max(0, percent - reportedPercent),
            message: `${state.completed}/${state.total} · ${path.basename(state.targetPath)}`,
          });
          reportedPercent = percent;
        },
      });
    }
  );
}

function explorerResources(resource: unknown, selectedResources: unknown): vscode.Uri[] {
  const contextual = isFileUri(resource) ? resource : undefined;
  const selected = Array.isArray(selectedResources)
    ? selectedResources.filter(isFileUri)
    : [];
  const contextualKey = contextual?.fsPath ? pathKey(contextual.fsPath) : '';
  const effective = contextual && !selected.some(uri => pathKey(uri.fsPath) === contextualKey)
    ? [contextual]
    : selected.length > 0
      ? selected
      : contextual
        ? [contextual]
        : [];
  return [...new Map(effective.map(uri => [pathKey(uri.fsPath), uri])).values()];
}

async function pickTargetRoots(
  driveRoot: string,
  rememberedTargets: readonly string[]
): Promise<string[] | undefined> {
  const quickPick = vscode.window.createQuickPick<DirectoryTargetItem>();
  const selectedPaths = new Map(
    rememberedTargets.map(target => [pathKey(target), path.resolve(target)])
  );
  const openFolderButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('folder-opened'),
    tooltip: '进入目录',
  };
  const clearButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('clear-all'),
    tooltip: '清空已勾选目录',
  };
  let currentDirectory = path.resolve(driveRoot);
  let visibleItems: readonly DirectoryTargetItem[] = [];
  let refreshVersion = 0;
  let settled = false;
  let updatingItems = false;

  quickPick.canSelectMany = true;
  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;

  const captureVisibleSelections = (): void => {
    const selectedVisible = new Set(quickPick.selectedItems.map(item => pathKey(item.directoryPath)));
    for (const item of visibleItems) {
      const key = pathKey(item.directoryPath);
      if (selectedVisible.has(key)) selectedPaths.set(key, item.directoryPath);
      else selectedPaths.delete(key);
    }
    quickPick.title = `同步其他区 · 已勾选 ${selectedPaths.size} 个目录`;
  };

  const refresh = async (): Promise<void> => {
    const version = ++refreshVersion;
    quickPick.busy = true;
    try {
      const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
      if (version !== refreshVersion) return;
      const isDriveRoot = pathKey(currentDirectory) === pathKey(path.parse(currentDirectory).root);
      const items: DirectoryTargetItem[] = [];
      if (!isDriveRoot) {
        items.push({
          label: '$(folder) 当前目录',
          description: currentDirectory,
          directoryPath: currentDirectory,
          alwaysShow: true,
        });
      }
      for (const entry of entries
        .filter(item => item.isDirectory() && !item.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(
          right.name,
          'zh-CN',
          { numeric: true, sensitivity: 'base' }
        ))) {
        const directoryPath = path.join(currentDirectory, entry.name);
        items.push({
          label: `$(folder) ${entry.name}`,
          description: directoryPath,
          directoryPath,
          alwaysShow: true,
          buttons: [openFolderButton],
        });
      }
      visibleItems = items;
      updatingItems = true;
      try {
        quickPick.items = items;
        quickPick.selectedItems = items.filter(item => selectedPaths.has(pathKey(item.directoryPath)));
      } finally {
        updatingItems = false;
      }
      quickPick.buttons = isDriveRoot
        ? [clearButton]
        : [vscode.QuickInputButtons.Back, clearButton];
      quickPick.title = `同步其他区 · 已勾选 ${selectedPaths.size} 个目录`;
      quickPick.placeholder = `从 ${driveRoot} 勾选目标服务端根目录；点击文件夹右侧图标继续进入`;
    } catch (error) {
      quickPick.placeholder = `无法读取 ${currentDirectory}: ${errorText(error)}`;
      visibleItems = [];
      quickPick.items = [];
    } finally {
      if (version === refreshVersion) quickPick.busy = false;
    }
  };

  return new Promise<string[] | undefined>(resolve => {
    const finish = (value: string[] | undefined): void => {
      if (settled) return;
      settled = true;
      quickPick.dispose();
      resolve(value);
    };
    quickPick.onDidChangeSelection(() => {
      if (!updatingItems) captureVisibleSelections();
    });
    quickPick.onDidTriggerItemButton(event => {
      captureVisibleSelections();
      currentDirectory = event.item.directoryPath;
      quickPick.value = '';
      void refresh();
    });
    quickPick.onDidTriggerButton(button => {
      captureVisibleSelections();
      if (button === vscode.QuickInputButtons.Back) {
        currentDirectory = path.dirname(currentDirectory);
      } else if (button === clearButton) {
        selectedPaths.clear();
      }
      quickPick.value = '';
      void refresh();
    });
    quickPick.onDidAccept(() => {
      captureVisibleSelections();
      if (selectedPaths.size === 0) {
        quickPick.placeholder = '请至少勾选一个目标服务端根目录';
        return;
      }
      finish([...selectedPaths.values()]);
    });
    quickPick.onDidHide(() => finish(undefined));
    void refresh();
    quickPick.show();
  });
}

function writeSyncResult(output: vscode.OutputChannel, result: ZoneSyncResult): void {
  output.appendLine(
    `完成 ${result.completedOperations}/${result.totalOperations} 次：`
    + `覆盖 ${result.overwrittenFiles}，新建文件 ${result.createdFiles}，新建目录 ${result.createdDirectories}`
  );
  if (result.failures.length === 0) return;
  output.appendLine(`失败 ${result.failures.length} 次:`);
  for (const failure of result.failures) {
    output.appendLine(`  ${failure.sourcePath} -> ${failure.targetPath}`);
    output.appendLine(`    ${failure.message}`);
  }
}

function displayRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath) || path.basename(filePath);
}

function isFileUri(value: unknown): value is vscode.Uri {
  return Boolean(
    value
    && typeof value === 'object'
    && 'scheme' in value
    && (value as { scheme?: unknown }).scheme === 'file'
    && 'fsPath' in value
    && typeof (value as { fsPath?: unknown }).fsPath === 'string'
  );
}

function isExistingDirectory(directoryPath: string): boolean {
  try { return fs.statSync(directoryPath).isDirectory(); } catch { return false; }
}

function sameRoot(candidate: string, root: string): boolean {
  return pathKey(path.parse(path.resolve(candidate)).root) === pathKey(path.resolve(root));
}

function pathKey(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
