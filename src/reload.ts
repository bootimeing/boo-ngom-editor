/**
 * M2自动重载 — 守护进程版
 *
 * 架构：VS Code → stdin/stdout → M2Reloader(常驻守护进程) → PostMessage → M2Server
 * 每次命令即时枚举窗口，零缓存，零失效。
 */
import { refreshVariableTree } from './assistant';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { secureWebviewHtml } from './utils/webview-security';
import { getEngineDefinition } from './utils/engine-registry';
import { resolveEngineRoot } from './utils/engine-detect';
import { buildReloadPathCommand, findM2PathFromLocation } from './utils/m2-target';
import { normalizeReloadSelection } from './utils/reload-options';

let outputChannel: vscode.OutputChannel;
let exePath: string | null = null;
let daemon: cp.ChildProcess | null = null;
let extContext: vscode.ExtensionContext | null = null;
/** 命令队列 */
let cmdSeq = Promise.resolve();
let daemonStarting = false;

const RELOAD_DEBOUNCE_MS = 500;

function getReloadItems(): string[] {
  const engine = vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM');
  if (!getEngineDefinition(engine).reloadVerified) return [];
  const key = `boo.reloadItems_${engine}`;
  if (extContext) {
    const saved = extContext.workspaceState.get<(string | number)[]>(key);
    if (saved && saved.length > 0) {
      const normalized = normalizeReloadSelection(saved);
      if (normalized.changed) {
        extContext.workspaceState.update(key, normalized.items);
        outputChannel?.appendLine('[重载] 已清理旧版数字ID配置，使用菜单名称重载项');
      }
      return normalized.items;
    }
  }
  // 默认按菜单名称匹配，跨 M2 版本兼容
  return ['所有NPC'];
}

function getExePath(extPath: string): string | null {
  const paths = [
    path.join(extPath, 'tools', 'M2Reloader', 'runtime', 'native-win-x64', 'M2Reloader.exe'),
    path.join(extPath, 'tools', 'M2Reloader', 'bin', 'Release', 'native-win-x64', 'M2Reloader.exe'),
    path.join(extPath, 'tools', 'M2Reloader.exe')
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isM2ScriptPath(filePath: string): boolean {
  return /[\/\\](?:Mir200[\/\\])?Envir[\/\\]/i.test(filePath);
}

function getTargetM2Path(documentPath?: string): string | null {
  if (documentPath) {
    const fromDocument = findM2PathFromLocation(documentPath);
    if (fromDocument) return fromDocument;
  }

  const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activePath) {
    const fromEditor = findM2PathFromLocation(activePath);
    if (fromEditor) return fromEditor;
  }

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const engineRoot = resolveEngineRoot(folder.uri.fsPath);
    const candidate = path.join(engineRoot, 'Mir200', 'M2Server.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// 守护进程管理
// ═══════════════════════════════════════════════════════════

function getDaemon(): cp.ChildProcess | null {
  if (!exePath) return null;
  if (daemon && !daemon.killed && daemon.exitCode === null) return daemon;

  if (daemonStarting) return null;
  daemonStarting = true;

  outputChannel.appendLine('[daemon] 启动守护进程...');
  let proc: cp.ChildProcess;
  try {
    proc = cp.spawn(exePath, ['daemon'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (e) {
    outputChannel.appendLine(`[daemon] spawn 失败: ${e instanceof Error ? e.message : String(e)}`);
    daemonStarting = false;
    return null;
  }

  proc.stderr!.on('data', (d: Buffer) => {
    for (const line of d.toString().trim().split('\n')) {
      if (line) outputChannel.appendLine('[daemon] ' + line);
    }
  });

  proc.on('exit', (code, sig) => {
    outputChannel.appendLine(`[daemon] 退出 (code=${code} sig=${sig})`);
    daemon = null;
    daemonStarting = false;
  });

  proc.on('error', (err) => {
    outputChannel.appendLine(`[daemon] 启动失败: ${err.message}`);
    daemon = null;
    daemonStarting = false;
  });

  daemon = proc;
  daemonStarting = false;
  return proc;
}

function sendDaemonCommand(cmd: string): Promise<string> {
  const promise = cmdSeq.then(() => new Promise<string>((resolve) => {
    const d = getDaemon();
    if (!d || !d.stdin || !d.stdout) {
      resolve('ERR:daemon not running');
      return;
    }

    let buffer = '';
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      d.stdout!.removeListener('data', onData);
    };
    const finish = () => {
      cleanup();
      resolve(buffer.trim() || 'OK');
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve(buffer.trim() || 'ERR:timeout');
    }, 10000);

    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, 40);
    };

    d.stdout.on('data', onData);
    try { d.stdin.write(cmd + '\n'); } catch {
      cleanup();
      resolve('ERR:write failed');
    }
  }));

  cmdSeq = promise.then(() => {}).catch(() => {});
  return promise;
}

function killDaemon() {
  if (daemon && !daemon.killed) {
    try { daemon.stdin?.write('exit\n'); } catch { /* ignore */ }
    setTimeout(() => {
      try { daemon?.kill(); } catch { /* ignore */ }
    }, 2000);
  }
}

// ═══════════════════════════════════════════════════════════
// 激活 / 停用
// ═══════════════════════════════════════════════════════════

export function activateReload(context: vscode.ExtensionContext) {
  extContext = context;
  exePath = getExePath(context.extensionPath);
  if (!exePath) {
    vscode.window.showWarningMessage('BOO M2自动重载不可用：未找到 M2Reloader.exe，请重新安装扩展。');
    return;
  }

  outputChannel = vscode.window.createOutputChannel('BOO M2重载');
  outputChannel.appendLine(`M2守护进程路径: ${exePath}`);
  outputChannel.appendLine('守护进程模式已激活 — 按工作区 M2 路径与菜单名称双重匹配');

  // 预启动守护进程
  getDaemon();
  vscode.window.setStatusBarMessage('BOO M2重载已就绪', 5000);

  const pendingSaves = new Map<string, Set<string>>();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!doc.fileName.endsWith('.txt') && !doc.fileName.endsWith('.ini')) return;
      if (!isM2ScriptPath(doc.fileName)) return;
      const autoReload = context.workspaceState.get('boo.autoReload', true);
      if (!autoReload) return;

      const targetPath = getTargetM2Path(doc.fileName);
      if (!targetPath) {
        outputChannel.appendLine(`[重载] 无法从保存路径定位 M2Server.exe: ${doc.fileName}`);
        return;
      }
      const names = pendingSaves.get(targetPath) || new Set<string>();
      names.add(path.basename(doc.fileName));
      pendingSaves.set(targetPath, names);
      if (reloadTimer) clearTimeout(reloadTimer);

      reloadTimer = setTimeout(() => {
        void (async () => {
          const batches = [...pendingSaves.entries()];
          pendingSaves.clear();
          reloadTimer = null;

          const items = getReloadItems();
          if (items.length === 0) {
            outputChannel.appendLine('[重载] 当前引擎的 M2 重载协议尚未通过验证，已跳过');
            return;
          }
          for (const [m2Path, savedSet] of batches) {
            const savedNames = [...savedSet];
            const label = savedNames.length === 1 ? savedNames[0] : `${savedNames.length} 个文件`;
            outputChannel.appendLine(`[保存] ${label} -> ${m2Path}`);
            const command = buildReloadPathCommand(m2Path, items);
            const result = command.startsWith('ERR:')
              ? command
              : await sendDaemonCommand(command);
            outputChannel.appendLine('[重载] ' + result);
            if (result.startsWith('ERR'))
              vscode.window.setStatusBarMessage('M2重载失败', 5000);
            else try { refreshVariableTree(); } catch { /* ignore */ }
          }
        })().catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`[重载] 保存触发失败: ${message}`);
          vscode.window.setStatusBarMessage('M2重载失败', 5000);
        });
      }, RELOAD_DEBOUNCE_MS);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.reloadM2', async () => {
      const items = getReloadItems();
      if (items.length === 0) {
        vscode.window.showWarningMessage('当前引擎的 M2 重载协议尚未通过验证，未发送重载命令。');
        return;
      }
      const targetPath = getTargetM2Path();
      if (!targetPath) {
        vscode.window.showWarningMessage('M2重载失败：当前工作区内未找到 Mir200\\M2Server.exe。');
        return;
      }
      const command = buildReloadPathCommand(targetPath, items);
      const result = command.startsWith('ERR:')
        ? command
        : await sendDaemonCommand(command);
      if (result.startsWith('ERR'))
        vscode.window.showWarningMessage('M2重载失败: ' + result.substring(4));
      else {
        vscode.window.setStatusBarMessage('M2重载已发送', 3000);
        try { refreshVariableTree(); } catch { /* ignore */ }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.scanM2', async () => {
      const targetPath = getTargetM2Path();
      const result = !targetPath
        ? 'ERR:当前工作区内未找到 Mir200\\M2Server.exe'
        : await sendDaemonCommand(`scanpath:${targetPath}`);
      const panel = vscode.window.createWebviewPanel(
        'booM2Menu', 'M2 菜单结构', vscode.ViewColumn.Active,
        { enableScripts: false, retainContextWhenHidden: true }
      );
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        `<html><body style="background:#1e1e1e;color:#ccc;font-family:Consolas,monospace;padding:16px;white-space:pre-wrap;font-size:12px">${result.replace(/</g, '&lt;')}</body></html>`,
        { enableScripts: false }
      );
    })
  );

  context.subscriptions.push({ dispose: killDaemon });
}

export function deactivateReload() {
  killDaemon();
}

export async function scanM2Windows(_c: vscode.ExtensionContext): Promise<string> {
  const targetPath = getTargetM2Path();
  if (!targetPath) return 'ERR:当前工作区内未找到 Mir200\\M2Server.exe';
  return sendDaemonCommand(`scanpath:${targetPath}`);
}
