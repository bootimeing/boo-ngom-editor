import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveEngineRoot } from '../utils/engine-detect';
import {
  buildQuickFileCandidates,
  createCustomQuickFileDefinition,
  CUSTOM_QUICK_FILES_STATE_KEY,
  customQuickFilePathError,
  normalizeCustomQuickFilePaths,
  normalizeMir200RelativePath,
  QUICK_FILE_DEFINITIONS,
  QuickFileDefinition,
  quickFileDisplayPath,
} from '../utils/quick-files';

interface QuickFilePickItem extends vscode.QuickPickItem {
  action?: 'add' | 'remove';
  definition?: QuickFileDefinition;
}

export function registerQuickFileCommands(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('boo.openQuickFiles', () => openQuickFile(context)),
    vscode.commands.registerCommand('boo.saveAll', async () => {
      await vscode.commands.executeCommand('workbench.action.files.saveAll');
    })
  );
}

async function openQuickFile(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('请先打开传奇服务端工作区。');
    return;
  }

  while (true) {
    const customPaths = readCustomQuickFilePaths(context);
    const definitions = [
      ...QUICK_FILE_DEFINITIONS,
      ...customPaths.map(createCustomQuickFileDefinition),
    ];
    const actions: QuickFilePickItem[] = [
      {
        label: '$(add) 添加自定义文件',
        description: '相对于 Mir200 目录',
        alwaysShow: true,
        action: 'add',
      },
    ];
    if (customPaths.length > 0) {
      actions.push({
        label: '$(trash) 移除自定义文件',
        description: '只移除快捷项，不删除原文件',
        alwaysShow: true,
        action: 'remove',
      });
    }

    const selected = await vscode.window.showQuickPick<QuickFilePickItem>(
      [
        ...actions,
        ...definitions.map(definition => ({
          label: definition.custom ? `$(file) ${definition.fileName}` : definition.fileName,
          description: definition.description,
          detail: quickFileDisplayPath(definition),
          alwaysShow: true,
          definition,
        })),
      ],
      {
        title: '快捷文件',
        placeHolder: '选择要打开的服务端文件',
        matchOnDescription: true,
        matchOnDetail: true,
      }
    );
    if (!selected) return;
    if (selected.action === 'add') {
      await addCustomQuickFile(context, customPaths);
      continue;
    }
    if (selected.action === 'remove') {
      await removeCustomQuickFiles(context, customPaths);
      continue;
    }
    if (!selected.definition) return;

    const uri = await resolveQuickFileUri(selected.definition);
    if (!uri) {
      void vscode.window.showWarningMessage(
        `未找到 ${selected.definition.fileName}，预期路径：${quickFileDisplayPath(selected.definition)}`
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }
}

async function resolveQuickFileUri(
  definition: QuickFileDefinition
): Promise<vscode.Uri | undefined> {
  const activePath = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? vscode.window.activeTextEditor.document.uri.fsPath
    : undefined;
  const activeFolder = activePath
    ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(activePath))
    : undefined;
  const workspaceFolders = [
    ...(activeFolder ? [activeFolder] : []),
    ...(vscode.workspace.workspaceFolders || []).filter(folder => folder !== activeFolder),
  ];

  for (const folder of workspaceFolders) {
    const workspaceRoot = folder.uri.fsPath;
    const engineRoot = resolveEngineRoot(workspaceRoot);
    const candidates = buildQuickFileCandidates(
      workspaceRoot,
      engineRoot,
      activePath,
      definition
    );
    const existing = candidates.find(candidate => fs.existsSync(candidate));
    if (existing) return vscode.Uri.file(existing);
  }

  const matches = await vscode.workspace.findFiles(
    `**/${definition.fileName}`,
    '**/{node_modules,.git,artifacts}/**',
    50
  );
  const expectedSuffix = normalizePath(quickFileDisplayPath(definition));
  return matches.find(uri => normalizePath(uri.fsPath).endsWith(`/${expectedSuffix}`));
}

function readCustomQuickFilePaths(context: vscode.ExtensionContext): string[] {
  return normalizeCustomQuickFilePaths(
    context.workspaceState.get<unknown>(CUSTOM_QUICK_FILES_STATE_KEY, [])
  );
}

async function addCustomQuickFile(
  context: vscode.ExtensionContext,
  existingPaths: string[]
): Promise<void> {
  const existing = new Set(existingPaths.map(value => value.toLowerCase()));
  const value = await vscode.window.showInputBox({
    title: '添加自定义快捷文件',
    prompt: '输入相对于 Mir200 的文件路径',
    placeHolder: '例如 Envir\\QuestDiary\\功能脚本\\示例.txt',
    ignoreFocusOut: true,
    validateInput(input) {
      const error = customQuickFilePathError(input);
      if (error) return error;
      const normalized = normalizeMir200RelativePath(input);
      return normalized && existing.has(normalized.toLowerCase())
        ? '此快捷文件已经存在'
        : undefined;
    },
  });
  if (value === undefined) return;
  const normalized = normalizeMir200RelativePath(value);
  if (!normalized || existing.has(normalized.toLowerCase())) return;
  await context.workspaceState.update(
    CUSTOM_QUICK_FILES_STATE_KEY,
    [...existingPaths, normalized]
  );
  void vscode.window.showInformationMessage(`已添加快捷文件：${path.join('Mir200', ...normalized.split('/'))}`);
}

async function removeCustomQuickFiles(
  context: vscode.ExtensionContext,
  existingPaths: string[]
): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    existingPaths.map(relativePath => ({
      label: path.win32.basename(relativePath.replace(/\//g, '\\')),
      detail: path.join('Mir200', ...relativePath.split('/')),
      relativePath,
      picked: false,
    })),
    {
      title: '移除自定义快捷文件',
      placeHolder: '勾选要移除的快捷项',
      canPickMany: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    }
  );
  if (!selected || selected.length === 0) return;
  const removed = new Set(selected.map(item => item.relativePath.toLowerCase()));
  await context.workspaceState.update(
    CUSTOM_QUICK_FILES_STATE_KEY,
    existingPaths.filter(item => !removed.has(item.toLowerCase()))
  );
  void vscode.window.showInformationMessage(`已移除 ${removed.size} 个自定义快捷项`);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/').replace(/\\/g, '/').toLowerCase();
}
