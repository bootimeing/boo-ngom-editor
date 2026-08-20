/**
 * BOO 可视化编辑器 — 基于v1.1.7稳定架构
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { activateAssistant, deactivateAssistant } from './assistant';
import {
  clearArchiveResourceContext,
  postToSidebar,
  replaySidebarMessage,
  resolveCachedPatchPakImageAsset,
  resolvePakImage,
  resolvePakImageAsset,
  setExtContext,
  setLoadedPakAssets,
  setPakFolder,
  setSidebarView,
} from "./utils/sidebar-bridge";
import {
  buildMonsterIconPreviews,
  describeMonsterBodyAppearance,
  loadMonsterDatabaseDetail,
  saveMonsterDatabaseDetailText,
} from './utils/database-detail';
import { resolveEngineRoot } from './utils/engine-detect';
import { EngineId, WebviewMessage } from './types';
import { activateReload, deactivateReload } from './reload';
import { cleanAllLogs } from './utils/log-cleaner';
import { CsvEditorProvider } from './providers/csv-editor';
import { XlsEditorProvider } from './providers/xls-editor';
import { clearPakCache, loadPakIndex, matchPakFile } from './utils/pak';
import { decodePakFully, DecodedPakAsset, DecodedPakResult } from './utils/pak-reader';
import { openArchiveIndexed } from './utils/archive-index';
import {
  archiveAssetUri,
  ArchiveResourceProvider,
  ARCHIVE_RESOURCE_SCHEME,
  webviewResourceRoots,
} from './utils/archive-resource-provider';
import { disposeGmBridge, ensureGmBridge } from './utils/gm-bridge';
import { TableEditorProvider } from './providers/table-editor';
import { PatchManagerProvider } from './providers/patch-manager';
import { MapPreviewProvider } from './providers/map-preview';
import { MerchantMapLinkProvider } from './providers/merchant-map-link';
import {
  DeepSeekViewProvider,
  openDeepSeekInBrowser,
  openDeepSeekPanelCommand,
  startDeepSeekServerCommand,
} from './providers/deepseek-view';
import {
  findPasswordInPakTxt as findPasswordInNearbyPakTxt,
  isPakPasswordError,
  pakPasswordSecretKey,
  readPakPasswordRecords,
  resolvePakPasswordFromRecords,
} from './utils/pak-password';
import {
  mergePakHistory,
  PakHistoryEntry,
  prunePakHistory,
} from './utils/pak-history';
import {
  CachedPatchPak,
  findCachedPatchPakByPath,
  invalidatePatchCacheIndex,
  isPatchCacheCurrent,
  loadCachedPatchPakResult,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  SavedPatchManagerState,
} from './utils/patch-cache';
import {
  getPakCacheRoot,
  getPatchCacheRoot,
  getArchiveIndexRoot,
  initializeCacheStorage,
} from './utils/cache-storage';
import { secureWebviewHtml } from './utils/webview-security';
import {
  ENGINE_DEFINITIONS,
  getEngineDefinition,
  normalizeEngineId,
} from './utils/engine-registry';
import {
  ArchiveExtension,
  isPairedArchiveExtension,
} from './utils/archive-types';
import {
  uiEditorArchiveExtensions,
  uiEditorArchiveLabel,
} from './utils/ui-archive';
import {
  archiveFileKey,
  clientResourceLayoutFromState,
  ClientResourceLayout,
  isPathInsideAny,
  scanClientArchiveFiles,
} from './utils/client-resources';
import { registerZoneSyncCommand } from './commands/zone-sync';
import { registerQuickFileCommands } from './commands/quick-files';

let currentPanel: vscode.WebviewPanel | undefined;
let extensionContext: vscode.ExtensionContext;
let resourceRootsSet = new Set<string>();
let loadedPakResults = new Map<string, DecodedPakResult>();
const OPENED_PAK_PATHS_STATE_KEY = 'boo.openedPakPaths';
const PAK_HISTORY_STATE_KEY = 'boo.pakHistory';
const QUICK_IMPORTS_STATE_KEY = 'boo.quickImports';
let loadedPakEngine: EngineId = 'GOM';
let archiveOperationVersion = 0;

interface QuickImportAssetData {
  name?: string;
  filePath?: string;
  url?: string;
  isDefault?: boolean;
  assetIdx?: number;
  imageIdx?: number;
  pakName?: string;
  willIdx?: number;
}

interface QuickImportData extends QuickImportAssetData {
  bg?: QuickImportAssetData;
  fill?: QuickImportAssetData;
  offsetX?: number;
  offsetY?: number;
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  loadedPakEngine = normalizeEngineId(
    vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
  );
  const cacheMigration = initializeCacheStorage(context);
  const archiveResourceProvider = new ArchiveResourceProvider(
    context.extensionPath,
    cacheMigration.roots.archiveIndex
  );
  context.subscriptions.push(
    archiveResourceProvider,
    vscode.workspace.registerFileSystemProvider(
      ARCHIVE_RESOURCE_SCHEME,
      archiveResourceProvider,
      { isCaseSensitive: true, isReadonly: true }
    )
  );
  if (cacheMigration.movedEntries > 0) {
    console.info(
      `[BOO] 已将旧 PAK 缓存迁移到 ${cacheMigration.roots.base}`
    );
  }
  if (cacheMigration.warnings.length > 0) {
    console.warn('[BOO] 旧 PAK 缓存迁移未完成:', cacheMigration.warnings.join('；'));
    vscode.window.showWarningMessage(
      'BOO 旧补丁缓存迁移未完成，请关闭其他 VS Code 窗口后重新启动'
    );
  }
  setExtContext(context);
  activateAssistant(context);
  context.subscriptions.push(registerZoneSyncCommand(context));
  context.subscriptions.push(registerQuickFileCommands(context));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('boo.engine')) return;
      void switchLoadedArchiveEngine(context);
    })
  );

  // 工作区自动设置 GB2312 编码（传奇脚本默认编码）
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) {
    const vscodeDir = path.join(wsRoot, '.vscode');
    const settingsFile = path.join(vscodeDir, 'settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { /* ignore */ }
    }
    if (settings['files.encoding'] !== 'gb2312') {
      settings['files.encoding'] = 'gb2312';
      try {
        fs.mkdirSync(vscodeDir, { recursive: true });
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      } catch { /* ignore */ }
    }
  }
  try { activateReload(context); } catch (e) { console.warn('[BOO] M2重载激活失败:', e instanceof Error ? e.message : String(e)); }

  resourceRootsSet.add(context.extensionPath);
  resourceRootsSet.add(path.join(context.extensionPath, 'media'));

  const patchManagerProvider = new PatchManagerProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('boo.patchView', patchManagerProvider)
  );
  void patchManagerProvider.autoLoadOrCache();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('boo.editorView', new BooSidebarProvider())
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('boo.toolsView', new ToolsViewProvider())
  );

  const mapPreviewProvider = new MapPreviewProvider(context);
  const merchantMapLinkProvider = new MerchantMapLinkProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('boo.mapPreviewView', mapPreviewProvider),
    vscode.languages.registerDocumentLinkProvider(
      [
        { language: 'gomscript', scheme: 'file' },
        { language: 'plaintext', scheme: 'file' },
      ],
      merchantMapLinkProvider
    ),
    vscode.commands.registerCommand(
      'boo.openMerchantNpcOnMap',
      (sourceUri: unknown, lineNumber: unknown) => mapPreviewProvider.revealMerchantNpc(sourceUri, lineNumber)
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeepSeekViewProvider.viewType,
      new DeepSeekViewProvider(context)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.deepseek.openPanel', () => openDeepSeekPanelCommand()),
    vscode.commands.registerCommand('boo.deepseek.openInBrowser', () => void openDeepSeekInBrowser()),
    vscode.commands.registerCommand('boo.deepseek.startServer', () => void startDeepSeekServerCommand())
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("boo.dbView", new class implements vscode.WebviewViewProvider {
      resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };
        setSidebarView(webviewView);
        webviewView.onDidDispose(() => setSidebarView(undefined));
        const htmlPath = path.join(extensionContext.extensionPath, "media", "sidebar-detail.html");
        webviewView.webview.html = secureWebviewHtml(
          webviewView.webview,
          fs.readFileSync(htmlPath, "utf-8"),
          { allowInlineEventHandlers: true }
        );
        webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
          if (msg.type === 'sidebarReady') {
            replaySidebarMessage();
            return;
          }
          if (msg.type === 'saveMonsterDetail') {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const name = String(msg.name || '').trim();
            const key = msg.key === 'dropRateText' || msg.key === 'iconText' ? msg.key : undefined;
            const fields = msg.fields && typeof msg.fields === 'object' && !Array.isArray(msg.fields)
              ? msg.fields as Record<string, unknown>
              : {};
            const columnLabels = msg.columnLabels && typeof msg.columnLabels === 'object' && !Array.isArray(msg.columnLabels)
              ? msg.columnLabels as Record<string, unknown>
              : {};
            const columnDescriptions = msg.columnDescriptions && typeof msg.columnDescriptions === 'object' && !Array.isArray(msg.columnDescriptions)
              ? msg.columnDescriptions as Record<string, unknown>
              : {};
            if (!wsRoot || !key) {
              void webviewView.webview.postMessage({
                type: 'monsterDetailSaveResult',
                key: key || String(msg.key || ''),
                ok: false,
                message: wsRoot ? '不支持的怪物配置类型' : '请先打开服务端工作区',
              });
              return;
            }
            try {
              const envirDir = path.join(resolveEngineRoot(wsRoot), 'Mir200', 'Envir');
              const saved = saveMonsterDatabaseDetailText(envirDir, name, key, msg.text);
              const detail = loadMonsterDatabaseDetail(envirDir, name);
              const preview = buildMonsterIconPreviews(detail.icons, resolvePakImageAsset);
              const activeEngine = normalizeEngineId(
                vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
              );
              const body = describeMonsterBodyAppearance(envirDir, name, fields, activeEngine);
              const bodyAsset = body.source === 'archive' && body.pakName
                ? resolveCachedPatchPakImageAsset(body.pakName, body.imageIndex)
                : body.source === 'will' && body.willIndex !== undefined
                  ? resolvePakImageAsset(body.willIndex, body.imageIndex)
                  : { url: '' };
              postToSidebar({
                type: 'showDatabaseDetail',
                detailKind: 'monster',
                name,
                fields,
                columnLabels,
                columnDescriptions,
                dropRateText: detail.dropRateText,
                dropRateFileName: detail.dropRateFileName,
                iconText: detail.iconText,
                iconFileName: detail.iconFileName,
                monsterIcons: preview.icons,
                iconConfigTruncated: preview.iconConfigTruncated,
                monsterBody: { ...body, ...bodyAsset },
                saveResult: {
                  key,
                  ok: true,
                  message: `已保存 ${saved.fileName}`,
                },
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.warn('[BOO] 保存怪物配置失败:', message);
              void webviewView.webview.postMessage({
                type: 'monsterDetailSaveResult',
                key,
                ok: false,
                message,
              });
            }
            return;
          }
          if (msg.type === 'saveItemDesc') {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!wsRoot) return;
            const envirDir = path.join(wsRoot, 'Mir200', 'Envir');
            const fileName = msg.key === 'topDesc' ? 'ItemDescTopList.txt' : 'ItemDescList.txt';
            const filePath = path.join(envirDir, fileName);
            try {
              const iconv = require('iconv-lite');
              let content = '';
              if (fs.existsSync(filePath)) {
                const buf = fs.readFileSync(filePath);
                content = iconv.decode(buf, 'gbk');
              }
              const lines = content.split(String.fromCharCode(10));
              let found = false;
              for (let i = 0; i < lines.length; i++) {
                const eq = lines[i].indexOf('=');
                if (eq > 0 && lines[i].substring(0, eq).trim() === msg.name) {
                  lines[i] = msg.name + '=' + msg.text;
                  found = true; break;
                }
              }
              if (!found) lines.push(msg.name + '=' + msg.text);
              const gbkBuf = iconv.encode(lines.join(String.fromCharCode(10)), 'gbk');
              fs.writeFileSync(filePath, Buffer.from(gbkBuf));
              // Re-read and push update
              const topPath = path.join(envirDir, 'ItemDescTopList.txt');
              const descPath2 = path.join(envirDir, 'ItemDescList.txt');
              let newTop = '', newDesc = '';
              const readLine = (fp2: string) => {
                if (!fs.existsSync(fp2)) return '';
                const b2 = fs.readFileSync(fp2);
                for (const l of iconv.decode(b2, 'gbk').split(String.fromCharCode(10))) {
                  const eq2 = l.indexOf('=');
                  if (eq2 > 0 && l.substring(0, eq2).trim() === msg.name) return l.substring(eq2 + 1).trim();
                }
                return '';
              };
              newTop = readLine(topPath);
              newDesc = readLine(descPath2);
              const imgMap: Record<string,string> = {};
              const imgRe3 = /<&?img:(\d+):(-?\d+):(-?\d+):(-?\d+)>/gi;
              let im3; const allText2 = newTop + String.fromCharCode(10) + newDesc;
              while ((im3 = imgRe3.exec(allText2)) !== null) {
                const key3 = im3[0];
                if (!imgMap[key3]) {
                  const url3 = resolvePakImage(parseInt(im3[2]), parseInt(im3[1]));
                  if (url3) imgMap[key3] = url3;
                }
              }
              postToSidebar({
                type: 'showDatabaseDetail',
                detailKind: 'item',
                name: msg.name,
                topDesc: newTop,
                itemDesc: newDesc,
                fields: {},
                images: imgMap,
                preserveSelectionVisuals: true,
              });
            } catch (e) {
              console.warn('[BOO] 保存物品描述失败:', e instanceof Error ? e.message : String(e));
            }
          }
        });
        webviewView.onDidChangeVisibility(() => {
          if (webviewView.visible) vscode.commands.executeCommand("boo.openDatabase");
        });
        vscode.commands.executeCommand("boo.openDatabase");
      }
    }())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.openFontSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'editor.fontFamily');
    })
  );
  let colorPickerPanel: vscode.WebviewPanel | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.openColorSettings', () => {
      if (colorPickerPanel) { colorPickerPanel.reveal(); return; }
      colorPickerPanel = vscode.window.createWebviewPanel('booColorPicker', 'BOO 语法颜色设置', vscode.ViewColumn.Active, {
        enableScripts: true, retainContextWhenHidden: true
      });
      const colorHtml = fs.readFileSync(path.join(context.extensionPath, 'media', 'color-picker.html'), 'utf-8');
      colorPickerPanel.webview.html = secureWebviewHtml(
        colorPickerPanel.webview,
        colorHtml,
        { allowInlineEventHandlers: true }
      );
      colorPickerPanel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'load') {
          // 读取已保存的设置
          const ws = vscode.workspace.workspaceFolders?.[0];
          const wsCfg = ws ? vscode.workspace.getConfiguration('editor', ws.uri) : null;
          const customizations = wsCfg
            ? wsCfg.get<{ rules?: Record<string, string | { foreground?: string }> }>('semanticTokenColorCustomizations')
            : undefined;
          const savedRules = Object.fromEntries(
            Object.entries(customizations?.rules || {})
              .map(([key, value]) => [key, typeof value === 'string' ? value : value.foreground])
              .filter((entry): entry is [string, string] => Boolean(entry[1]))
          );
          colorPickerPanel!.webview.postMessage({ type: 'load', rules: savedRules });
        } else if (msg.type === 'save') {
          const ws = vscode.workspace.workspaceFolders?.[0];
          if (ws) {
            const wsCfg = vscode.workspace.getConfiguration('editor', ws.uri);
            const current = wsCfg.get<{ rules?: Record<string, unknown> }>('semanticTokenColorCustomizations') || {};
            await wsCfg.update(
              'semanticTokenColorCustomizations',
              {
                ...current,
                enabled: true,
                rules: { ...(current.rules || {}), ...msg.rules },
              },
              vscode.ConfigurationTarget.Workspace
            );
          }
          vscode.window.showInformationMessage('语法颜色已保存并应用');
        }
      });
      colorPickerPanel.onDidDispose(() => { colorPickerPanel = undefined; });
    })
  );

  // ---- 常用脚本指令侧边栏 ----
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('boo.clipboardView', new ClipboardViewProvider(context))
  );
  context.subscriptions.push(CsvEditorProvider.register(context));
  context.subscriptions.push(XlsEditorProvider.register(context));
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.insertClipboardSnippet', (text: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit(eb => eb.insert(editor.selection.active, text));
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.addToClipboard', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('请先选中要加入常用指令的代码');
        return;
      }
      const text = editor.document.getText(editor.selection).trim();
      const list: { text: string; time: number }[] = extensionContext.workspaceState.get('boo.clipboardSnippets', []);
      if (list.length >= 50) { vscode.window.showWarningMessage('常用指令已达上限（50条）'); return; }
      if (list.some(item => item.text === text)) { vscode.window.showInformationMessage('该指令已存在'); return; }
      list.push({ text, time: Date.now() });
      extensionContext.workspaceState.update('boo.clipboardSnippets', list);
      vscode.window.setStatusBarMessage('已加入常用指令: ' + (text.length > 40 ? text.substring(0, 37) + '...' : text), 3000);
      notifyClipboardView(extensionContext);
    })
  );  context.subscriptions.push(TableEditorProvider.register());
  context.subscriptions.push(vscode.commands.registerCommand('boo.openEditor', () => openEditorPanel(context)));

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.cleanAllLogs', async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) { vscode.window.showWarningMessage('未打开工作区'); return; }
      const confirm = await vscode.window.showWarningMessage(
        '确定要清理所有日志文件吗？此操作不可撤销。',
        { modal: true }, '确定'
      );
      if (confirm !== '确定') return;
      const [filesOk, dirsOk, fail, skip] = await cleanAllLogs(wsRoot);
      const parts = [`${filesOk} 个文件已删除`];
      if (dirsOk > 0) parts.push(`${dirsOk} 个空目录已删除`);
      if (fail > 0) parts.push(`${fail} 个失败`);
      if (skip > 0) parts.push(`${skip} 个目录不存在已跳过`);
      const msg = `清理完成：${parts.join('，')}`;
      if (fail > 0) vscode.window.showWarningMessage(msg);
      else vscode.window.showInformationMessage(msg);
    })
  );
}

export async function deactivate() {
  deactivateAssistant();
  deactivateReload();
  await disposeGmBridge();
  if (currentPanel) currentPanel.dispose();
}

// ========== 侧边栏：可视化编辑器使用教程 ==========
class BooSidebarProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: false, enableCommandUris: true };
    webviewView.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{margin:0;padding:12px;font-family:'Microsoft YaHei',sans-serif;color:#ccc;background:transparent;line-height:1.7;font-size:12px}
h2{color:#00d4ff;font-size:14px;margin:0 0 6px 0;padding-bottom:6px;border-bottom:1px solid #333}
h3{color:#ffaa00;font-size:12px;margin:14px 0 4px}
.btn{display:block;width:100%;margin:10px 0;padding:12px 0;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;font-size:14px;font-weight:600;border:none;border-radius:8px;cursor:pointer;box-shadow:0 4px 15px rgba(14,165,233,0.4);text-align:center;text-decoration:none}
.step{margin:3px 0;padding-left:4px;color:#bbb;font-size:11px}
.step b{color:#ffaa00}
.step code{background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;color:#ffcc00;font-size:10px}
.dim{color:#888;font-size:10px}
.tip{margin:8px 0;padding:8px;background:rgba(0,212,255,0.06);border-left:3px solid #00d4ff;border-radius:4px;font-size:10px;color:#999}
.warn{margin:4px 0;padding:6px 8px;background:rgba(255,140,0,0.08);border-left:3px solid #ff8c00;border-radius:4px;font-size:10px;color:#ff8c00}
table{width:100%;border-collapse:collapse;font-size:10px;margin:4px 0}
td{padding:3px 4px;border-bottom:1px solid #222}
td:first-child{color:#ffcc00;white-space:nowrap}
ul{padding-left:14px;margin:2px 0;font-size:11px;color:#bbb}
li{margin:1px 0}
</style></head><body>
<h2>可视化编辑器 使用教程</h2>

<a class="btn" href="command:boo.openEditor">打开可视化编辑器</a>

<h3>第一步：准备素材</h3>
  <div class="step"><b>1.</b> 进入编辑器后点击工具栏 <code>打开资源包</code></div>
  <div class="step"><b>2.</b> 可一次选择多个服务端已调用的资源包</div>
  <div class="step"><b>3.</b> PAK/JPK 首次读取时按提示输入对应资源密码</div>
  <div class="step"><b>4.</b> 后续打开其他资源包会追加到当前素材列表</div>

<h3>第二步：搭建界面</h3>
<div class="step"><b>1.</b> <b>双击</b>素材列表中的图片 → 添加到画布</div>
<div class="step"><b>2.</b> 第一张图片自动作为对话框<b>背景</b></div>
<div class="step"><b>3.</b> 工具栏选择元素类型添加文字/按钮/特效等</div>
<div class="step"><b>4.</b> <b>拖拽</b>移动位置，<b>滚轮</b>缩放画布</div>

<h3>第三步：调整属性</h3>
<div class="step"><b>1.</b> 点击画布上的元素可<b>选中</b></div>
<div class="step"><b>2.</b> 右侧<b>属性面板</b>精确修改坐标/尺寸/颜色</div>
<div class="step"><b>3.</b> <b>Ctrl+点击</b>可多选，方向键微调位置</div>

<h3>第四步：生成代码</h3>
<div class="step"><b>1.</b> 点击 <code>代码区</code> 打开代码浮窗</div>
<div class="step"><b>2.</b> 输入 <code>will序号</code>（WIL资源文件编号）</div>
<div class="step"><b>3.</b> 代码会根据画布元素<b>自动生成</b></div>
<div class="step"><b>4.</b> 复制代码到 NPC 脚本文件中使用</div>

<h3>10种设计元素</h3>
<table>
<tr><td>IMG图片</td><td>双击素材添加，装饰/NPC界面</td></tr>
<tr><td>文字</td><td>静态文本/彩色文字/点击跳转</td></tr>
<tr><td>三态按钮</td><td>普通/悬停/按下三态图片按钮</td></tr>
<tr><td>特效动画</td><td>PlayImg 序列帧循环播放</td></tr>
<tr><td>倒计时</td><td>限时活动倒计时展示</td></tr>
<tr><td>文本框</td><td>@@InPutString 玩家输入框</td></tr>
<tr><td>数字框</td><td>@@InPutInteger 数字输入</td></tr>
<tr><td>关闭按钮</td><td>快捷导入，自定义关闭按钮</td></tr>
<tr><td>装备框</td><td>快捷导入，装备展示槽位</td></tr>
<tr><td>进度条</td><td>快捷导入，自定义进度条</td></tr>
</table>

<h3>画布操作技巧</h3>
<ul>
<li><b>滚轮</b> — 缩放画布 (25%~400%)</li>
<li><b>右键拖拽</b> — 平移画布</li>
<li><b>拖拽元素</b> — 移动位置</li>
<li><b>Ctrl+C/V</b> — 复制粘贴元素</li>
<li><b>Delete</b> — 删除选中元素</li>
<li><b>方向键</b> — 微调选中元素位置</li>
</ul>

<h3>NPC脚本联动</h3>
<div class="step">右键 .txt 脚本文件 → <b>联动到可视化编辑器</b></div>
<div class="step">画布修改 → 自动写入脚本文件 (300ms延迟)</div>
<div class="step">编辑脚本代码 → 画布自动还原界面 (800ms延迟)</div>
<div class="step">联动状态显示在工具栏，点击 ✕ 可断开</div>

<h3>快捷导入</h3>
<div class="step">素材面板底部有 <b>关闭按钮/装备框/进度条</b> 槽位</div>
<div class="step">点击槽位选择对应图片，点击 <b>调用</b> 添加到画布</div>
<div class="step">图片只需导入一次，后续在属性面板中直接使用</div>

<p class="dim" style="text-align:center;margin-top:12px">技术 QQ: <b style="color:#00d4ff">1167746</b></p>
</body></html>`;
    webviewView.webview.html = secureWebviewHtml(
      webviewView.webview,
      webviewView.webview.html,
      { enableScripts: false }
    );
  }
}

// ========== BOO脚本助手：完整文档+工具 ==========
class ToolsViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: false, enableCommandUris: true };
    const tools = [
      { cmd: 'boo.autoLoadSettings', label: '助手设置', desc: '配置代码补全/审查/M2重载项等开关', icon: '⚙️' },
      { cmd: 'boo.diagnoseAll', label: '代码审查', desc: '扫描所有脚本，检测未闭合标签、未定义引用等问题', icon: '✅' },
      { cmd: 'boo.analyzeVariables', label: '变量统计', desc: '扫描全工作区 .txt，按类别统计所有变量使用次数', icon: '📈' },
      { cmd: 'boo.openScriptSync', label: '脚本同步', desc: '选择文件或文件夹，同步替换到其他区', icon: '⇄' },
      { cmd: 'boo.openMapViewer', label: '地图查看器', desc: '预览 Mir200\\Map 目录下的 .map 地图文件', icon: '🗺️' },
      { cmd: 'boo.showAnisSymbols', label: 'ANIS特殊符号', desc: '点击复制常用特殊符号到剪贴板', icon: '🔣' },
      { cmd: 'boo.toUpperCaseAll', label: '所有脚本转大写', desc: '将Envir目录下所有脚本小写英文批量转大写', icon: '🔤' },
      { cmd: 'boo.openCompletionEditor', label: '代码补全编辑器', desc: '查看和自定义修改所有命令/变量/函数的补全数据', icon: '📋' },
      { cmd: 'boo.openColorSettings', label: '语法颜色设置', desc: '可视化调色板，修改语法着色颜色', icon: '🎨' },
    ];
    webviewView.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0}body{background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-size:12px;padding:8px;line-height:1.6}
h3{color:#00d4ff;font-size:13px;margin:12px 0 6px;padding:4px 0;border-bottom:1px solid #333}
.key{display:inline-block;background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;color:#ffcc00;margin:0 2px}
.desc{color:#aaa;font-size:11px;margin:2px 0 2px 12px}
.desc b{color:#e0e0e0}
.shortcut-group{color:#d7d7d7;font-size:11px;font-weight:bold;margin:8px 0 3px 12px}
a.t{display:flex;align-items:center;padding:7px 8px;margin:2px 0;border-radius:6px;text-decoration:none;color:inherit;background:var(--vscode-editor-background);border:1px solid transparent}
a.t:hover{background:#2a2a2a;border-color:#0e639c}
.ic{width:24px;font-size:14px;text-align:center;flex-shrink:0}
.in{flex:1;margin-left:6px}.in .n{font-weight:bold;color:#e0e0e0;font-size:12px}
.in .d{color:#888;font-size:10px;margin-top:1px}
.tip{padding:6px 8px;background:rgba(0,212,255,0.06);border-left:3px solid #00d4ff;border-radius:4px;font-size:11px;color:#999;margin:8px 0}
.warn{padding:6px 8px;background:rgba(255,140,0,0.08);border-left:3px solid #ff8c00;border-radius:4px;font-size:11px;color:#ff8c00;margin:4px 0}
.ft{display:flex;align-items:center;justify-content:center;gap:12px;white-space:nowrap;text-align:center;color:#555;font-size:10px;margin-top:12px;padding-top:6px;border-top:1px solid #333}
</style></head><body>
<h3>快捷工具</h3>
${tools.map(t => '<a class="t" href="command:' + t.cmd + '" title="' + t.desc + '"><span class="ic">' + t.icon + '</span><div class="in"><div class="n">' + t.label + '</div><div class="d">' + t.desc + '</div></div></a>').join('')}

<h3>快捷键</h3>
<div class="shortcut-group">BOO 脚本</div>
<div class="desc"><span class="key">Ctrl+D</span> 将选中变量转为 &lt;$STR(...)&gt;</div>
<div class="desc"><span class="key">Ctrl+Q</span> 执行当前问题的首选修复</div>
<div class="desc"><span class="key">Ctrl+F1</span> 快速插入颜色代码（256色调色板）</div>
<div class="desc"><span class="key">Alt+Shift+U</span> 选中文本智能大小写转换</div>
<div class="desc"><span class="key">Alt+X</span> 批量数值加减乘除或按顺序递增</div>
<div class="desc">可先 <span class="key">Alt+左键</span> 多光标选中不同位置数字，再按 <span class="key">Alt+X</span></div>
<div class="shortcut-group">编辑与导航</div>
<div class="desc"><span class="key">Ctrl+Space</span> 手动触发代码补全</div>
<div class="desc"><span class="key">Ctrl+.</span> 打开当前问题的快速修复菜单</div>
<div class="desc"><span class="key">F8 / Shift+F8</span> 下一个 / 上一个问题</div>
<div class="desc"><span class="key">F12 / Ctrl+Click</span> 跳转到标签定义</div>
<div class="desc"><span class="key">Shift+F12</span> 查找所有引用</div>
<div class="desc"><span class="key">Ctrl+/</span> 切换脚本行注释</div>
<div class="desc"><span class="key">Ctrl+G</span> 跳转到指定行</div>
<div class="desc"><span class="key">Ctrl+P</span> 快速打开脚本文件</div>
<div class="desc"><span class="key">Ctrl+S</span> 保存当前脚本并触发 M2 自动重载</div>
<div class="desc"><span class="key">Ctrl+K S</span> 全部保存并触发对应 M2 重载</div>
<div class="desc"><span class="key">Ctrl+Shift+P</span> 打开命令面板，可使用全部 BOO 功能</div>
<div class="shortcut-group">可视化工具</div>
<div class="desc"><span class="key">Ctrl+点击</span> UI 编辑器多选元素</div>
<div class="desc"><span class="key">Ctrl+C / Ctrl+V</span> 复制 / 粘贴 UI 元素</div>
<div class="desc"><span class="key">Delete</span> 删除 UI 编辑器选中元素</div>
<div class="desc"><span class="key">方向键</span> 微调 UI 元素、地图标识、NPC 或刷怪坐标</div>
<div class="desc"><span class="key">Ctrl+左键</span> 点击 Merchant.txt 的 NPC 名称，在原始地图定位</div>

<h3>智能编码</h3>
<div class="desc"><b>代码补全</b> — 输入命令自动提示，&lt;$ 变量 / @ 标签补全</div>
<div class="desc"><b>悬停文档</b> — 悬停查看命令参数和变量赋值来源</div>
<div class="desc"><b>实时诊断</b> — 标签/引用错误自动标注，灯泡一键修复</div>
<div class="desc"><b>定义跳转</b> — GOTO / #CALL / 路径引用 / @@输入框引用</div>

<h3>M2 自动重载</h3>
<div class="desc">保存脚本自动通知 M2Server 重载选中项</div>
<div class="desc">侧边栏 <b>助手设置</b> 可配置 18 项重载开关</div>
<div class="desc">默认仅「所有NPC」开启，可按需勾选</div>
<div class="warn">需<b>管理员身份</b>运行 VS Code</div>

<h3>内置工具</h3>
<div class="desc"><b>数据库查看器</b> — 当前引擎的物品、怪物与技能数据</div>
<div class="desc"><b>地图查看器</b> — Mir200\\Map 地图文件预览</div>
<div class="desc"><b>变量列表</b> — 左侧活动栏全工作区变量统计</div>

<div class="tip">右上角 <b>全部保存</b> 可一键保存所有文件并触发 M2 重载</div>
<div class="ft"><span>技术 QQ: <b style="color:#00d4ff">1167746</b></span><span>交流群: <b style="color:#00d4ff">58505745</b></span></div>
</body></html>`;
    webviewView.webview.html = secureWebviewHtml(
      webviewView.webview,
      webviewView.webview.html,
      { enableScripts: false }
    );
  }
}

// ========== 编辑器面板 ==========
function openEditorPanel(context: vscode.ExtensionContext) {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  createEditorPanel(context);
}

function createEditorPanel(context: vscode.ExtensionContext) {
  loadedPakEngine = normalizeEngineId(
    vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
  );
  resourceRootsSet = new Set();
  loadedPakResults = new Map();
  resourceRootsSet.add(context.extensionPath);
  resourceRootsSet.add(path.join(context.extensionPath, 'media'));

  currentPanel = vscode.window.createWebviewPanel('booEditor', 'BOO 可视化编辑器', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: webviewResourceRoots(resourceRootsSet)
  });

  currentPanel.webview.html = getWebviewContent(context, currentPanel.webview);

  currentPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    if (!currentPanel) return;
    switch (message.type) {
      case 'openPakFiles':
        await handleOpenPakFiles(currentPanel!, context);
        break;
      case 'openPakHistory':
        await handleOpenPakHistory(currentPanel!, context);
        break;
      case 'closePak': {
        const pakName = typeof message.pakName === 'string' ? message.pakName.trim() : '';
        if (pakName) await closeLoadedPak(currentPanel!, context, pakName);
        break;
      }
      case 'reloadAssets': {
        const pakPaths = [...loadedPakResults.values()].map(item => item.pakPath);
        const archiveLabel = currentArchiveLabel();
        currentPanel!.webview.postMessage({ type: 'reloadAssetsState', loading: true });
        try {
          if (pakPaths.length === 0) {
            vscode.window.showWarningMessage(`当前没有已打开的 ${archiveLabel}`);
            break;
          }
          await loadPakFiles(currentPanel!, context, pakPaths, true);
        } catch (error) {
          vscode.window.showErrorMessage(`重新读取 ${archiveLabel} 失败: ` + (error instanceof Error ? error.message : String(error)));
        } finally {
          currentPanel?.webview.postMessage({ type: 'reloadAssetsState', loading: false });
        }
        break;
      }
      case 'clearCanvas': {
        const confirmResult = await vscode.window.showWarningMessage('确定要清空画布吗？', { modal: true }, '确定');
        if (confirmResult === '确定') currentPanel!.webview.postMessage({ type: 'clearCanvas' });
        break;
      }
      case 'showToast':
        vscode.window.showInformationMessage((message.text as string) || '');
        break;
      case 'error':
        vscode.window.showErrorMessage((message.text as string) || '发生错误');
        break;
      case 'selectQuickImportFile': {
        const typeLabels: Record<string, string> = { 'closeBtn': '关闭按钮', 'equipFrame': '装备框', 'progressBar': '进度条' };
        const label = typeLabels[message.importType as string] || '文件';
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          openLabel: '选择' + label + '图片',
          filters: { '图片文件': ['png', 'gif', 'bmp', 'jpg', 'jpeg'] }
        });
        if (result && result.length > 0) {
          const filePath = result[0].fsPath;
          const fileDir = path.dirname(filePath);
          resourceRootsSet.add(fileDir);
          currentPanel!.webview.options = {
            enableScripts: true,
            localResourceRoots: webviewResourceRoots(resourceRootsSet)
          };
          const uri = currentPanel!.webview.asWebviewUri(vscode.Uri.file(filePath));
          currentPanel!.webview.postMessage({
            type: 'loadQuickImport', importType: message.importType as string, subType: message.subType as string | undefined,
            name: path.basename(filePath), url: uri.toString(), filePath
          });
          // 进度条需要等待背景图和填充图都确认后再整体保存。
          if (message.importType !== 'progressBar') {
            const quickImports = readQuickImports(context, loadedPakEngine);
            quickImports[message.importType as string] = { name: path.basename(filePath), filePath };
            await context.workspaceState.update(quickImportsStateKey(loadedPakEngine), quickImports);
          }
        }
        break;
      }
      case 'getEnginePref': {
        const eng = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        const definition = getEngineDefinition(eng);
        currentPanel!.webview.postMessage({
          type: 'loadEnginePref',
          engine: definition.webviewId,
          uiCodeGenerationVerified: definition.uiCodeGenerationVerified,
        });
        break;
      }
      case 'saveEnginePref':
        if (message.engine) {
          const definition = ENGINE_DEFINITIONS.find(
            candidate => candidate.webviewId === message.engine
          );
          if (definition) {
            const target = vscode.workspace.workspaceFolders?.length
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global;
            await vscode.workspace.getConfiguration('boo').update('engine', definition.id, target);
          }
        }
        break;
      case 'getLinkedState':
        currentPanel!.webview.postMessage({ type: 'syncFromEditor', code: '', filePath: '', fileName: '', linked: false });
        break;
      case 'getDefaultMaterials': {
        // 扫描默认素材目录，按引擎和类型筛选
        const eng = normalizeEngineId(
          vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
        );
        const engDir = eng === 'GEE'
          ? '翎风引擎'
          : eng === '996PC'
            ? '996PC引擎'
            : 'NGOM引擎';
        const defDir = path.join(context.extensionPath, '默认素材', engDir);
        const items: { name: string; url: string; desc: string; filePath: string }[] = [];
        if (fs.existsSync(defDir)) {
          resourceRootsSet.add(defDir);
          currentPanel!.webview.options = {
            enableScripts: true,
            localResourceRoots: webviewResourceRoots(resourceRootsSet)
          };
          const files = fs.readdirSync(defDir).filter(f => /\.png$/i.test(f)).sort();
          for (const f of files) {
            // 格式: pak名字-序号描述.png
            const withoutExt = f.replace(/\.png$/i, '');
            const match = withoutExt.match(/^(.+?)-(\d+)(.+)?$/);
            const desc = match ? (match[3] || match[1]) : withoutExt;
            const filePath = path.join(defDir, f);
            const uri = currentPanel!.webview.asWebviewUri(vscode.Uri.file(filePath));
            items.push({ name: f, url: uri.toString(), desc, filePath });
          }
        }
        currentPanel!.webview.postMessage({ type: 'loadDefaultMaterials', items, engDir });
        break;
      }
      case 'saveQuickImport': {
        // 保存快捷导入（来自PAK或默认素材选择）
        const qi = readQuickImports(context, loadedPakEngine);
        const structuredData = message.data && typeof message.data === 'object'
          ? message.data as QuickImportData
          : undefined;
        qi[message.importType as string] = structuredData || {
          name: message.name as string,
          filePath: (message.filePath as string) || '',
        };
        await context.workspaceState.update(quickImportsStateKey(loadedPakEngine), qi);
        break;
      }
      case 'getQuickImports': {
        const saved = readQuickImports(context, loadedPakEngine);
        const imports: Record<string, QuickImportData> = {};
        const invalidTypes: string[] = [];
        for (const [type, data] of Object.entries(saved)) {
          if (data.bg || data.fill) {
            const hydrate = (asset?: QuickImportAssetData): QuickImportAssetData | undefined => {
              if (!asset) return undefined;
              if (!asset.filePath || !fs.existsSync(asset.filePath)) return { ...asset, url: '' };
              resourceRootsSet.add(path.dirname(asset.filePath));
              return {
                ...asset,
                url: currentPanel!.webview.asWebviewUri(vscode.Uri.file(asset.filePath)).toString(),
              };
            };
            imports[type] = { ...data, bg: hydrate(data.bg), fill: hydrate(data.fill) };
            continue;
          }
          if (data.filePath && fs.existsSync(data.filePath)) {
            resourceRootsSet.add(path.dirname(data.filePath));
            const uri = currentPanel!.webview.asWebviewUri(vscode.Uri.file(data.filePath));
            imports[type] = { ...data, url: uri.toString() };
          } else {
            invalidTypes.push(type);
          }
        }
        currentPanel!.webview.options = {
          enableScripts: true,
          localResourceRoots: webviewResourceRoots(resourceRootsSet)
        };
        currentPanel!.webview.postMessage({ type: 'loadQuickImports', imports, invalidTypes });
        if (invalidTypes.length > 0) {
          for (const t of invalidTypes) delete saved[t];
          await context.workspaceState.update(quickImportsStateKey(loadedPakEngine), saved);
        }
        break;
      }
    }
  }, undefined, context.subscriptions);

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    loadedPakResults.clear();
  }, null, context.subscriptions);

  restoreOpenedPakFiles(currentPanel, context);
}

function restoreOpenedPakFiles(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
  const restoreEngine = loadedPakEngine;
  const stateKey = openedPakPathsStateKey(restoreEngine);
  const savedPaths = context.workspaceState.get<string[]>(
    stateKey,
    restoreEngine === 'GOM'
      ? context.workspaceState.get<string[]>(OPENED_PAK_PATHS_STATE_KEY, [])
      : []
  );
  const existingPaths = [...new Map(savedPaths
    .filter(filePath => typeof filePath === 'string' && fs.existsSync(filePath))
    .map(filePath => {
      const resolvedPath = path.resolve(filePath);
      return [normalizePakPath(resolvedPath), resolvedPath];
    })).values()];
  if (existingPaths.length !== savedPaths.length) {
    void context.workspaceState.update(stateKey, existingPaths);
  }
  if (existingPaths.length === 0) return;

  setTimeout(() => {
    void (async () => {
      if (currentPanel !== panel || loadedPakEngine !== restoreEngine) return;
      try {
        panel.webview.postMessage({ type: 'reloadAssetsState', loading: true });
        await loadPakFiles(panel, context, existingPaths);
      } catch (error) {
        vscode.window.showErrorMessage(`恢复上次打开的 ${currentArchiveLabel()} 失败: ` + (error instanceof Error ? error.message : String(error)));
      } finally {
        if (currentPanel === panel && loadedPakEngine === restoreEngine) {
          panel.webview.postMessage({ type: 'reloadAssetsState', loading: false });
        }
      }
    })();
  }, 500);
}

async function handleOpenPakFiles(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
  const selectionEngine = loadedPakEngine;
  const archiveLabel = uiEditorArchiveLabel(selectionEngine);
  const layout = getClientResourceLayoutForEngine(context, selectionEngine);
  const calledArchives = await listCalledClientArchives(context, selectionEngine, layout);
  const cachedPatchPaks = calledArchives.map(({ pakPath, willIdx }) => {
    const cachedPak = findCachedPatchPakByPath(
      getPatchCacheRoot(context),
      pakPath,
      layout?.dataRoots || [],
      isPairedArchiveExtension(path.extname(pakPath).slice(1).toLowerCase())
        ? 'direct'
        : archivePreviewMode()
    );
    return cachedPak && isPatchCacheCurrent(cachedPak)
      ? { cachedPak, willIdx }
      : undefined;
  }).filter((item): item is { cachedPak: CachedPatchPak; willIdx: number } => !!item);
  const opened = new Set([...loadedPakResults.values()].map(item => normalizePakPath(item.pakPath)));
  const picks: PakSourceQuickPickItem[] = [
    {
      label: `$(folder-opened) 打开新的 ${archiveLabel}...`,
      description: `从磁盘选择一个或多个 ${archiveLabel} 文件`,
      alwaysShow: true,
      action: 'new',
    },
  ];
  if (cachedPatchPaks.length > 0) {
    picks.push({
      label: `已经缓存的补丁 ${archiveLabel}`,
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const { cachedPak, willIdx } of cachedPatchPaks) {
      picks.push({
        label: path.basename(cachedPak.pakPath),
        description: opened.has(normalizePakPath(cachedPak.pakPath))
          ? '已打开'
          : `WIL ${willIdx}，${cachedPak.slotCount} 项`,
        detail: cachedPak.pakPath,
        cachedPak,
      });
    }
  }
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: `打开新的 ${archiveLabel}，或选择已经缓存的补丁 ${archiveLabel}`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected || loadedPakEngine !== selectionEngine || currentPanel !== panel) return;
  if (selected.action === 'new') {
    await selectNewPakFiles(panel, context);
    return;
  }
  if (!selected.cachedPak) return;
  const pakPaths = [
    ...[...loadedPakResults.values()].map(item => item.pakPath),
    selected.cachedPak.pakPath,
  ];
  try {
    await loadPakFiles(panel, context, pakPaths);
  } catch (error) {
    vscode.window.showErrorMessage(`加载补丁缓存 ${currentArchiveLabel()} 失败: ` + (error instanceof Error ? error.message : String(error)));
  }
}

interface PakSourceQuickPickItem extends vscode.QuickPickItem {
  action?: 'new';
  cachedPak?: CachedPatchPak;
}

async function selectNewPakFiles(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
  const selectionEngine = loadedPakEngine;
  const definition = getEngineDefinition(selectionEngine);
  const extensions = uiEditorArchiveExtensions(selectionEngine);
  const label = uiEditorArchiveLabel(selectionEngine);
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    openLabel: `打开 ${label} 文件`,
    filters: { [`${definition.label}资源文件`]: extensions },
  });
  if (
    !result ||
    result.length === 0 ||
    loadedPakEngine !== selectionEngine ||
    currentPanel !== panel
  ) return;
  const pakPaths = [
    ...[...loadedPakResults.values()].map(item => item.pakPath),
    ...result.map(uri => uri.fsPath),
  ];
  try {
    await loadPakFiles(panel, context, pakPaths);
  } catch (error) {
    vscode.window.showErrorMessage(`加载 ${label} 失败: ` + (error instanceof Error ? error.message : String(error)));
  }
}

function getPatchManagerStateForEngine(
  context: vscode.ExtensionContext,
  engine: EngineId
): SavedPatchManagerState | undefined {
  const state = context.workspaceState.get<SavedPatchManagerState>(
    patchManagerStateKey(engine)
  ) || context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
  if (state?.engine && state.engine !== engine) return undefined;
  return state;
}

function getClientResourceLayoutForEngine(
  context: vscode.ExtensionContext,
  engine: EngineId
): ClientResourceLayout | undefined {
  return clientResourceLayoutFromState(getPatchManagerStateForEngine(context, engine));
}

async function listCalledClientArchives(
  _context: vscode.ExtensionContext,
  engine: EngineId,
  layout: ClientResourceLayout | undefined
): Promise<Array<{ pakPath: string; willIdx: number }>> {
  if (!layout) return [];
  clearPakCache();
  const archivePaths = await scanClientArchiveFiles(
    layout.dataRoots,
    uiEditorArchiveExtensions(engine)
  );
  const called = archivePaths.map(pakPath => {
    const pakIndex = findPakIndexNearFolder(path.dirname(pakPath));
    const matched = pakIndex ? matchPakFile(pakPath, pakIndex.pakList) : undefined;
    return matched ? { pakPath, willIdx: matched.willIdx } : undefined;
  }).filter((item): item is { pakPath: string; willIdx: number } => !!item);
  return called.sort((left, right) => (
    left.willIdx - right.willIdx
    || left.pakPath.localeCompare(right.pakPath, 'zh-CN', { numeric: true, sensitivity: 'base' })
  ));
}

interface PakHistoryQuickPickItem extends vscode.QuickPickItem {
  entry: PakHistoryEntry;
}

async function handleOpenPakHistory(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
  const selectionEngine = loadedPakEngine;
  const supportedExtensions = new Set(uiEditorArchiveExtensions(selectionEngine));
  const currentPaths = [...loadedPakResults.values()].map(item => item.pakPath);
  const layout = getClientResourceLayoutForEngine(context, selectionEngine);
  const calledArchives = await listCalledClientArchives(context, selectionEngine, layout);
  const calledPaths = new Set(calledArchives.map(item => normalizePakPath(item.pakPath)));
  const saved = mergePakHistory(
    context.workspaceState.get<PakHistoryEntry[]>(PAK_HISTORY_STATE_KEY, []),
    currentPaths
  );
  await context.workspaceState.update(PAK_HISTORY_STATE_KEY, saved);
  const existingHistory = prunePakHistory(saved, filePath => fs.existsSync(filePath));
  if (existingHistory.length !== saved.length) {
    await context.workspaceState.update(PAK_HISTORY_STATE_KEY, existingHistory);
  }
  const history = existingHistory.filter(entry => (
    supportedExtensions.has(
      path.extname(entry.path).slice(1).toLowerCase() as ArchiveExtension
    )
    && calledPaths.has(normalizePakPath(entry.path))
  ));
  if (history.length === 0) {
    vscode.window.showInformationMessage(`暂无可用的 ${[...supportedExtensions].join('/').toUpperCase()} 历史记录`);
    return;
  }

  const opened = new Set([...loadedPakResults.values()].map(item => normalizePakPath(item.pakPath)));
  const picks = history.map<PakHistoryQuickPickItem>(entry => ({
    label: path.basename(entry.path),
    description: opened.has(normalizePakPath(entry.path)) ? '已打开' : new Date(entry.lastOpenedAt).toLocaleString(),
    detail: entry.path,
    picked: opened.has(normalizePakPath(entry.path)),
    entry,
  }));
  const selected = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    placeHolder: '选择要追加打开的历史资源包',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (
    !selected ||
    selected.length === 0 ||
    loadedPakEngine !== selectionEngine ||
    currentPanel !== panel
  ) return;

  const pakPaths = [
    ...[...loadedPakResults.values()].map(item => item.pakPath),
    ...selected.map(item => item.entry.path),
  ];
  try {
    await loadPakFiles(panel, context, pakPaths);
  } catch (error) {
    vscode.window.showErrorMessage(`加载历史 ${currentArchiveLabel()} 失败: ` + (error instanceof Error ? error.message : String(error)));
  }
}

async function closeLoadedPak(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  pakName: string
) {
  const operationEngine = loadedPakEngine;
  const operationVersion = ++archiveOperationVersion;
  const remainingResults = new Map(loadedPakResults);
  let removedCount = 0;
  for (const [key, item] of remainingResults) {
    if (item.pakName.localeCompare(pakName, undefined, { sensitivity: 'base' }) === 0) {
      remainingResults.delete(key);
      removedCount++;
    }
  }
  if (removedCount === 0) return;

  await context.workspaceState.update(
    openedPakPathsStateKey(operationEngine),
    [...remainingResults.values()].map(item => item.pakPath)
  );
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  const pakHistory = mergePakHistory(
    context.workspaceState.get<PakHistoryEntry[]>(PAK_HISTORY_STATE_KEY, []),
    [...remainingResults.values()].map(item => item.pakPath)
  );
  await context.workspaceState.update(PAK_HISTORY_STATE_KEY, pakHistory);
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  loadedPakResults = remainingResults;
  const firstRemaining = remainingResults.values().next().value as DecodedPakResult | undefined;
  setPakFolder(firstRemaining ? path.dirname(firstRemaining.pakPath) : undefined);
  setLoadedPakAssets([...remainingResults.values()].flatMap(item => item.assets));
  postLoadedPakAssets(panel);
  const archiveLabel = uiEditorArchiveLabel(operationEngine);
  vscode.window.setStatusBarMessage(`已关闭 ${archiveLabel}: ${pakName}`, 3000);
}

async function loadPakFiles(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  pakPaths: string[],
  forceRefresh = false
) {
  const operationEngine = loadedPakEngine;
  const operationVersion = ++archiveOperationVersion;
  const definition = getEngineDefinition(operationEngine);
  const archiveLabel = uiEditorArchiveLabel(operationEngine);
  const supportedExtensions = new Set(uiEditorArchiveExtensions(operationEngine));
  const configuredPreviewMode = archivePreviewMode();
  const clientLayout = getClientResourceLayoutForEngine(context, operationEngine);
  const patchResourceRoots = clientLayout?.dataRoots || [];
  const managedArchivePaths = clientLayout
    ? await scanClientArchiveFiles(clientLayout.dataRoots, uiEditorArchiveExtensions(operationEngine))
    : [];
  const preferredManagedPaths = new Map(
    managedArchivePaths.map(filePath => [archiveFileKey(filePath), filePath])
  );
  const uniquePaths = [...new Map(pakPaths.map(filePath => {
    const resolvedPath = path.resolve(filePath);
    const preferredPath = preferredManagedPaths.get(archiveFileKey(resolvedPath)) || resolvedPath;
    return [normalizePakPath(preferredPath), preferredPath];
  })).values()];
  // EffectImageList.txt may be edited while the editor is open. Re-read it for every action.
  clearPakCache();
  const cacheRoot = getPakCacheRoot(context);
  const archiveIndexRoot = getArchiveIndexRoot(context);
  const patchCacheRoot = getPatchCacheRoot(context);
  fs.mkdirSync(cacheRoot, { recursive: true });
  const resolved: {
    pakPath: string;
    password: string;
    willIdx: number;
    extension: ArchiveExtension;
    storageMode: 'direct' | 'legacy';
    legacyFallback?: CachedPatchPak;
  }[] = [];
  const decodedFromPatchCache: DecodedPakResult[] = [];
  const skipped: string[] = [];

  for (const pakPath of uniquePaths) {
    if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
    const extension = path.extname(pakPath).slice(1).toLowerCase() as ArchiveExtension;
    if (!supportedExtensions.has(extension)) {
      skipped.push(`${path.basename(pakPath)}（不属于${definition.label}资源格式）`);
      continue;
    }
    const pakIndex = findPakIndexNearFolder(path.dirname(pakPath));
    const matched = pakIndex ? matchPakFile(pakPath, pakIndex.pakList) : undefined;
    if (!matched) {
      skipped.push(path.basename(pakPath));
      continue;
    }
    const storageMode = isPairedArchiveExtension(extension)
      ? 'direct'
      : configuredPreviewMode;
    const cachedPatchPak = findCachedPatchPakByPath(
      patchCacheRoot,
      pakPath,
      patchResourceRoots,
      storageMode
    );
    if (
      cachedPatchPak
      && isPatchCacheCurrent(cachedPatchPak)
      && cachedPatchPak.storageMode === storageMode
    ) {
      try {
        decodedFromPatchCache.push(loadCachedPatchPakResult(cachedPatchPak, matched.willIdx));
        continue;
      } catch (error) {
        console.warn(
          `[BOO] 补丁缓存 ${cachedPatchPak.pakName} 读取失败，回退到源 ${archiveLabel}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    const password = isPairedArchiveExtension(extension)
      ? ''
      : await resolvePakPassword(context, pakPath);
    if (
      password === undefined ||
      !isCurrentArchiveOperation(operationEngine, operationVersion, panel)
    ) return;
    const legacyFallback = storageMode === 'direct' && !isPairedArchiveExtension(extension)
      ? findCachedPatchPakByPath(
          patchCacheRoot,
          pakPath,
          patchResourceRoots,
          'legacy'
        )
      : undefined;
    resolved.push({
      pakPath,
      password,
      willIdx: matched.willIdx,
      extension,
      storageMode,
      legacyFallback: legacyFallback && isPatchCacheCurrent(legacyFallback)
        ? legacyFallback
        : undefined,
    });
  }
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  if (skipped.length > 0) {
    vscode.window.showWarningMessage(`服务端未调用此 ${archiveLabel}，已跳过: ${skipped.join('、')}`);
  }
  if (resolved.length === 0 && decodedFromPatchCache.length === 0) {
    await context.workspaceState.update(openedPakPathsStateKey(operationEngine), []);
    if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
    loadedPakResults.clear();
    setLoadedPakAssets([]);
    postLoadedPakAssets(panel);
    vscode.window.showWarningMessage(`没有可读取的 ${archiveLabel}，仅支持 EffectImageList.txt 中服务端已调用的文件`);
    return;
  }
  resolved.sort((left, right) => left.willIdx - right.willIdx);

  const freshlyDecoded = resolved.length === 0
    ? []
    : await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `BOO 正在读取 ${archiveLabel}`,
      cancellable: false,
    }, async progress => {
      const results = [];
      for (let pakNumber = 0; pakNumber < resolved.length; pakNumber++) {
        if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return [];
        const item = resolved[pakNumber];
        progress.report({ message: `${path.basename(item.pakPath)} (${pakNumber + 1}/${resolved.length})` });
        const decode = async (password: string): Promise<DecodedPakResult> => {
          if (item.storageMode === 'direct') {
            try {
              return await openArchiveIndexed({
                extensionPath: context.extensionPath,
                indexRoot: archiveIndexRoot,
                pakPath: item.pakPath,
                password,
                willIdx: item.willIdx,
                ensureBridge: () => ensureGmBridge(context),
                forceRefresh,
                onProgress: (_completed, _total, label) => progress.report({ message: label }),
              });
            } catch (error) {
              if (isPairedArchiveExtension(item.extension)) {
                throw new Error(`${path.basename(item.pakPath)}: ${error instanceof Error ? error.message : String(error)}`);
              }
              if (isPakPasswordError(error)) throw error;
              console.warn(
                `[BOO] ${path.basename(item.pakPath)} 高速读取失败，自动回退 V4.2.4 兼容模式:`,
                error instanceof Error ? error.message : String(error)
              );
              progress.report({ message: `${path.basename(item.pakPath)} 改用兼容模式` });
              if (item.legacyFallback) {
                return loadCachedPatchPakResult(item.legacyFallback, item.willIdx);
              }
            }
          }
          return decodePakFully({
            extensionPath: context.extensionPath,
            cacheRoot,
            pakPath: item.pakPath,
            password,
            willIdx: item.willIdx,
            ensureBridge: () => ensureGmBridge(context),
            forceRefresh,
            onProgress: (_completed, _total, label) => progress.report({ message: label }),
          });
        };
        let decodedPak;
        try {
          decodedPak = await decode(item.password);
        } catch (error) {
          if (
            isPairedArchiveExtension(item.extension)
            || !isPakPasswordError(error)
          ) throw error;
          if (findConfiguredPakPassword(context, item.pakPath, operationEngine) !== undefined) {
            throw new Error(`${path.basename(item.pakPath)}: 资源密码文件中配置的密码错误`);
          }
          await context.secrets.delete(pakPasswordSecretKey(item.pakPath));
          const retryPassword = await promptPakPassword(
            item.pakPath,
            '上次保存的密码错误，请重新输入'
          );
          if (retryPassword === undefined) {
            throw new Error(`${path.basename(item.pakPath)}: 已取消重新输入密码`);
          }
          item.password = retryPassword;
          try {
            decodedPak = await decode(item.password);
          } catch (retryError) {
            if (isPakPasswordError(retryError)) {
              await context.secrets.delete(pakPasswordSecretKey(item.pakPath));
            }
            throw retryError;
          }
        }
        if (
          !isPairedArchiveExtension(item.extension)
          && findConfiguredPakPassword(context, item.pakPath, operationEngine) === undefined
        ) {
          await context.secrets.store(pakPasswordSecretKey(item.pakPath), item.password);
        }
        if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return [];
        results.push(decodedPak);
      }
      return results;
    });
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  const decoded = [...decodedFromPatchCache, ...freshlyDecoded]
    .sort((left, right) => left.willIdx - right.willIdx);
  if (freshlyDecoded.some(item => item.storageMode === 'direct')) {
    invalidatePatchCacheIndex();
  }

  const nextResults = new Map(decoded.map(item => [normalizePakPath(item.pakPath), item]));
  await context.workspaceState.update(
    openedPakPathsStateKey(operationEngine),
    [...nextResults.values()].map(item => item.pakPath)
  );
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  const pakHistory = mergePakHistory(
    context.workspaceState.get<PakHistoryEntry[]>(PAK_HISTORY_STATE_KEY, []),
    [...nextResults.values()].map(item => item.pakPath)
  );
  await context.workspaceState.update(PAK_HISTORY_STATE_KEY, pakHistory);
  if (!isCurrentArchiveOperation(operationEngine, operationVersion, panel)) return;
  loadedPakResults = nextResults;
  setLoadedPakAssets(decoded.flatMap(item => item.assets));
  for (const item of loadedPakResults.values()) resourceRootsSet.add(item.cacheDir);
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: webviewResourceRoots(resourceRootsSet),
  };
  postLoadedPakAssets(panel);
  const firstFolder = path.dirname(decoded[0].pakPath);
  setPakFolder(firstFolder);
  const totalCount = [...loadedPakResults.values()].reduce((sum, item) => sum + item.assets.length, 0);
  vscode.window.setStatusBarMessage(`已读取 ${loadedPakResults.size} 个 ${archiveLabel}，共 ${totalCount} 张图片`, 5000);
}

function postLoadedPakAssets(panel: vscode.WebviewPanel) {
  const decoded = [...loadedPakResults.values()].sort((left, right) => left.willIdx - right.willIdx);
  const assets: DecodedPakAsset[] = decoded.flatMap(item => item.assets);
  const files = assets.map(asset => {
    const resourceUri = archiveAssetUri(asset) || vscode.Uri.file(asset.path);
    return {
      ...asset,
      url: panel.webview.asWebviewUri(resourceUri).toString(),
    };
  });
  const pakList = decoded
    .map(item => ({ name: item.pakName, willIdx: item.willIdx }))
    .sort((left, right) => left.willIdx - right.willIdx);
  const archiveLabel = uiEditorArchiveLabel(loadedPakEngine);
  const folderName = decoded.length > 0
    ? `${decoded.length} 个 ${archiveLabel}`
    : `未打开 ${archiveLabel}`;
  panel.webview.postMessage({
    type: 'loadAssets',
    files,
    folderName,
    folderPath: '',
    totalCount: files.length,
    pakMode: true,
    pakList,
    sourceType: loadedPakEngine === '996PC' ? 'jpk' : 'pak',
    archiveLabel,
  });
}

function normalizePakPath(pakPath: string): string {
  return path.resolve(pakPath).toLowerCase();
}

function archivePreviewMode(): 'direct' | 'legacy' {
  return vscode.workspace.getConfiguration('boo').get<'direct' | 'legacy'>(
    'archivePreviewMode',
    'direct'
  );
}

function quickImportsStateKey(engine: EngineId): string {
  return `${QUICK_IMPORTS_STATE_KEY}:${engine}`;
}

function readQuickImports(
  context: vscode.ExtensionContext,
  engine: EngineId
): Record<string, QuickImportData> {
  const engineValue = context.workspaceState.get<Record<string, QuickImportData>>(
    quickImportsStateKey(engine)
  );
  if (engineValue) return { ...engineValue };
  if (engine !== '996PC') {
    return {
      ...context.workspaceState.get<Record<string, QuickImportData>>(QUICK_IMPORTS_STATE_KEY, {}),
    };
  }
  return {};
}

function currentArchiveLabel(): string {
  return uiEditorArchiveLabel(loadedPakEngine);
}

function openedPakPathsStateKey(engine: EngineId): string {
  return `${OPENED_PAK_PATHS_STATE_KEY}:${engine}`;
}

async function switchLoadedArchiveEngine(context: vscode.ExtensionContext): Promise<void> {
  const nextEngine = normalizeEngineId(
    vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
  );
  if (nextEngine === loadedPakEngine) return;

  const sourceEngine = loadedPakEngine;
  const sourcePaths = [...loadedPakResults.values()].map(item => item.pakPath);
  const operationVersion = ++archiveOperationVersion;
  await context.workspaceState.update(
    openedPakPathsStateKey(sourceEngine),
    sourcePaths
  );
  if (operationVersion !== archiveOperationVersion) return;
  const latestEngine = normalizeEngineId(
    vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
  );
  if (latestEngine !== nextEngine) return;
  loadedPakEngine = nextEngine;
  loadedPakResults.clear();
  resourceRootsSet = new Set([
    context.extensionPath,
    path.join(context.extensionPath, 'media'),
  ]);
  clearArchiveResourceContext();
  if (!currentPanel) return;

  currentPanel.webview.options = {
    enableScripts: true,
    localResourceRoots: webviewResourceRoots(resourceRootsSet),
  };
  postLoadedPakAssets(currentPanel);
  const definition = getEngineDefinition(nextEngine);
  void currentPanel.webview.postMessage({
    type: 'loadEnginePref',
    engine: definition.webviewId,
    uiCodeGenerationVerified: definition.uiCodeGenerationVerified,
    reloadEngineResources: true,
  });
  restoreOpenedPakFiles(currentPanel, context);
}

function isCurrentArchiveOperation(
  engine: EngineId,
  operationVersion: number,
  panel: vscode.WebviewPanel
): boolean {
  return (
    loadedPakEngine === engine &&
    archiveOperationVersion === operationVersion &&
    currentPanel === panel
  );
}

function findPakIndexNearFolder(folderPath: string): ReturnType<typeof loadPakIndex> {
  const candidates: string[] = [];
  let current = path.resolve(folderPath);
  for (let depth = 0; depth < 5; depth++) {
    candidates.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) candidates.push(workspaceRoot);
  for (const candidate of [...new Set(candidates.map(item => item.toLowerCase()))]) {
    const original = candidates.find(item => item.toLowerCase() === candidate)!;
    const result = loadPakIndex(original);
    if (result) return result;
  }
  return null;
}

async function resolvePakPassword(context: vscode.ExtensionContext, pakPath: string): Promise<string | undefined> {
  const configured = findConfiguredPakPassword(context, pakPath, loadedPakEngine);
  if (configured !== undefined) return configured;
  const secretKey = pakPasswordSecretKey(pakPath);
  const saved = await context.secrets.get(secretKey);
  if (saved) return saved;
  return promptPakPassword(pakPath, '密码仅在验证成功后保存到 VS Code 安全存储中');
}

function findConfiguredPakPassword(
  context: vscode.ExtensionContext,
  pakPath: string,
  engine: EngineId
): string | undefined {
  const state = getPatchManagerStateForEngine(context, engine);
  const layout = clientResourceLayoutFromState(state);
  if (state?.passwordFile && fs.existsSync(state.passwordFile)) {
    try {
      const dataRoot = layout?.dataRoots.find(root => isPathInsideAny(pakPath, [root]));
      const selectedPassword = resolvePakPasswordFromRecords(
        readPakPasswordRecords(state.passwordFile),
        pakPath,
        dataRoot
      );
      if (selectedPassword !== undefined) return selectedPassword;
    } catch (error) {
      console.warn(
        '[BOO] 读取当前工作区资源密码文件失败:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return findPasswordInPakTxt(pakPath);
}

function promptPakPassword(pakPath: string, prompt: string): Thenable<string | undefined> {
  const archiveLabel = path.extname(pakPath).toLowerCase() === '.jpk' ? 'JPK' : 'PAK';
  return vscode.window.showInputBox({
    title: `${archiveLabel} 密码: ${path.basename(pakPath)}`,
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.length > 0 ? undefined : `请输入 ${archiveLabel} 密码`,
  });
}

function findPasswordInPakTxt(pakPath: string): string | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return findPasswordInNearbyPakTxt(pakPath, workspaceRoot);
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const htmlPath = path.join(context.extensionPath, 'media', 'editor.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/{{CSP_SOURCE}}/g, webview.cspSource);
  const baseUri = webview.asWebviewUri(vscode.Uri.file(context.extensionPath));
  html = html.replace(/src="resources\//g, 'src="' + baseUri + 'resources/');
  html = html.replace(/href="resources\//g, 'href="' + baseUri + 'resources/');
  return secureWebviewHtml(webview, html, { allowInlineEventHandlers: true });
}

// ========== 常用脚本指令侧边栏 ==========
let _clipboardView: vscode.WebviewView | undefined;
function notifyClipboardView(ctx: vscode.ExtensionContext) {
  if (_clipboardView) {
    const items = ctx.workspaceState.get<any[]>('boo.clipboardSnippets', []);
    _clipboardView.webview.postMessage({ type: 'list', items });
  }
}
class ClipboardViewProvider implements vscode.WebviewViewProvider {
  constructor(private _ctx: vscode.ExtensionContext) {}
  resolveWebviewView(webviewView: vscode.WebviewView) {
    _clipboardView = webviewView;
    webviewView.onDidDispose(() => { _clipboardView = undefined; });
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = secureWebviewHtml(
      webviewView.webview,
      this._getHtml(),
      { allowInlineEventHandlers: true }
    );
    const s = this._ctx.workspaceState;
    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'list': {
          webviewView.webview.postMessage({ type: 'list', items: s.get<any[]>('boo.clipboardSnippets', []) });
          break;
        }
        case 'add': {
          const code = (msg.text || '').trim(); if (!code) break;
          const list = s.get<any[]>('boo.clipboardSnippets', []);
          if (list.length >= 50) { webviewView.webview.postMessage({ type: 'toast', text: '最多50条' }); break; }
          list.push({ text: code, note: (msg.note || '').trim(), time: Date.now() });
          s.update('boo.clipboardSnippets', list);
          webviewView.webview.postMessage({ type: 'list', items: list });
          break;
        }
        case 'delete': {
          if (msg.idx !== undefined) { const l = s.get<any[]>('boo.clipboardSnippets', []); l.splice(msg.idx, 1); s.update('boo.clipboardSnippets', l); webviewView.webview.postMessage({ type: 'list', items: l }); }
          break;
        }
        case 'insert': {
          const ed = vscode.window.activeTextEditor; if (ed && msg.text) ed.edit(eb => eb.insert(ed.selection.active, msg.text));
          break;
        }
        case 'updateItem': {
          if (msg.idx !== undefined) { const l3 = s.get<any[]>('boo.clipboardSnippets', []); if (l3[msg.idx]) { l3[msg.idx].text = String(msg.text||'').trim(); l3[msg.idx].note = String(msg.note||'').trim(); s.update('boo.clipboardSnippets', l3); } webviewView.webview.postMessage({ type: 'list', items: l3 }); }
          break;
        }
      }
    });
  }
  private _getHtml(): string {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>\n'+
'*{margin:0;padding:0;box-sizing:border-box}\n'+
'body{background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-size:12px;padding:6px}\n'+
'h3{color:#00d4ff;font-size:12px;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #333}\n'+
'.inp{margin-bottom:8px}\n'+
'.inp textarea{width:100%;height:60px;padding:6px 8px;background:#333;color:#ffcc00;border:1px solid #555;border-radius:4px;font-size:11px;font-family:Consolas,monospace;resize:vertical;min-height:40px}\n'+
'.inp-row{display:flex;gap:4px;margin-top:4px}\n'+
'.inp-row input{flex:1;padding:3px 6px;background:#333;color:#fff;border:1px solid #555;border-radius:4px;font-size:11px}\n'+
'.inp-row button{padding:3px 10px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px}\n'+
'.inp-row button:hover{background:#1177bb}\n'+
'.item{padding:5px 6px;margin:2px 0;background:#2a2a2a;border-radius:4px;cursor:pointer}\n'+
'.item:hover{background:#333}\n'+
'.item .code{font-size:11px;font-family:Consolas,monospace;color:#ffcc00;word-break:break-all;white-space:pre-wrap;line-height:1.4}\n'+
'.item .note{font-size:10px;color:#888;margin-top:2px;font-style:italic}\n'+
'.item .del{float:right;color:#888;cursor:pointer;font-size:14px;padding:0 3px;opacity:0.5}\n'+
'.item .del:hover{color:#ff4444;opacity:1}\n'+
'.empty{color:#666;text-align:center;padding:20px 0;font-size:11px}\n'+
'.cnt{color:#888;font-size:10px;text-align:center;margin-bottom:4px}\n'+
'.tip{color:#666;font-size:10px;margin:2px 0 4px}\n'+
'.ctx-menu{display:none;position:fixed;background:#2d2d2d;border:1px solid #444;border-radius:4px;z-index:9999;min-width:80px}\n'+
'.ctx-menu div{padding:6px 12px;color:#d4d4d4;cursor:pointer;font-size:12px}\n'+
'.ctx-menu div:hover{background:#0e639c}\n'+
'.edit-panel{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9998;padding:20px}\n'+
'.edit-box{background:#1e1e1e;border:1px solid #444;border-radius:8px;padding:12px;max-width:500px;margin:40px auto}\n'+
'.edit-box textarea{width:100%;height:80px;padding:8px;background:#333;color:#ffcc00;border:1px solid #555;border-radius:4px;font-size:11px;font-family:Consolas,monospace;resize:vertical}\n'+
'.edit-box input{width:100%;padding:6px 8px;margin-top:8px;background:#333;color:#fff;border:1px solid #555;border-radius:4px;font-size:11px}\n'+
'.edit-box .btns{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}\n'+
'.edit-box .btns button{padding:5px 16px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}\n'+
'.edit-box .btns button.cancel{background:#444}\n'+
'.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:6px 16px;border-radius:4px;font-size:11px;z-index:10000;opacity:0;transition:opacity .3s}\n'+
'</style></head><body>\n'+
'<h3>常用脚本指令 (<span id="cnt">0</span>/50)</h3>\n'+
'<div class="inp">\n'+
'<textarea id="code" placeholder="指令代码 (支持多行)"></textarea>\n'+
'<div class="inp-row"><input id="note" placeholder="备注(可选)"><button onclick="add()">添加</button></div>\n'+
'<div class="tip">Shift+Enter添加 | Enter换行 | 点击复制 | 右键编辑</div>\n'+
'</div>\n'+
'<div id="list"></div>\n'+
'<div class="ctx-menu" id="ctxMenu"><div id="ctxCopy">📋 复制</div><div id="ctxEdit">✏️ 编辑</div></div>\n'+
'<div class="edit-panel" id="editPanel"><div class="edit-box"><textarea id="editCode"></textarea><input id="editNote" placeholder="备注"><div class="btns"><button class="cancel" onclick="cancelEdit()">取消</button><button onclick="saveEdit()">保存</button></div></div></div>\n'+
'<div class="toast" id="toastEl"></div>\n'+
'<script>\n'+
'var v=acquireVsCodeApi(),listData=[];\n'+
'v.postMessage({type:"list"});\n'+
'function add(){var c=document.getElementById("code");if(c.value.trim()){v.postMessage({type:"add",text:c.value.trim(),note:document.getElementById("note").value});c.value="";document.getElementById("note").value="";}}\n'+
'document.getElementById("code").addEventListener("keydown",function(e){if(e.key==="Enter"&&e.shiftKey){e.preventDefault();add();}});\n'+
'var editIdx=-1;\n'+
'document.getElementById("list").addEventListener("click",function(e){\n'+
'  var del=e.target.closest("[data-del]");if(del){e.stopPropagation();v.postMessage({type:"delete",idx:parseInt(del.getAttribute("data-del"))});return;}\n'+
'  var item=e.target.closest("[data-text]");if(item){var t=item.getAttribute("data-text");navigator.clipboard.writeText(t).then(function(){showTip("已复制")});return;}\n'+
'});\n'+
'document.getElementById("list").addEventListener("contextmenu",function(e){\n'+
'  var item=e.target.closest("[data-idx]");if(!item)return;e.preventDefault();var idx=parseInt(item.getAttribute("data-idx"));\n'+
'  var menu=document.getElementById("ctxMenu");menu.style.display="block";menu.style.left=e.clientX+"px";menu.style.top=e.clientY+"px";\n'+
'  menu.setAttribute("data-idx",idx);\n'+
'});\n'+
'document.getElementById("ctxCopy").addEventListener("click",function(){\n'+
'  var idx=parseInt(document.getElementById("ctxMenu").getAttribute("data-idx"));\n'+
'  if(listData[idx]){navigator.clipboard.writeText(listData[idx].text).then(function(){showTip("已复制")});}\n'+
'  document.getElementById("ctxMenu").style.display="none";\n'+
'});\n'+
'document.getElementById("ctxEdit").addEventListener("click",function(){\n'+
'  var idx=parseInt(document.getElementById("ctxMenu").getAttribute("data-idx"));\n'+
'  editIdx=idx;\n'+
'  var it=listData[idx];document.getElementById("editCode").value=it?it.text:"";document.getElementById("editNote").value=it&&it.note?it.note:"";\n'+
'  document.getElementById("editPanel").style.display="block";\n'+
'  document.getElementById("ctxMenu").style.display="none";\n'+
'});\n'+
'function saveEdit(){if(editIdx>=0){var c=document.getElementById("editCode").value.trim();if(c){v.postMessage({type:"updateItem",idx:editIdx,text:c,note:document.getElementById("editNote").value});}editIdx=-1;document.getElementById("editPanel").style.display="none";}}\n'+
'function cancelEdit(){editIdx=-1;document.getElementById("editPanel").style.display="none";}\n'+
'document.addEventListener("click",function(){document.getElementById("ctxMenu").style.display="none";});\n'+
'function render(){var items=listData,h="";document.getElementById("cnt").textContent=items.length;\n'+
'if(items.length===0)h=\'<div class="empty">暂无指令</div>\';\n'+
'for(var i=0;i<items.length;i++){var it=items[i],esc=it.text.replace(/&/g,"&amp;").replace(/"/g,"&quot;");h+=\'<div class="item" data-idx="\'+i+\'" data-text="\'+esc+\'"><span class="del" data-del="\'+i+\'">&times;</span><div class="code">\'+it.text.replace(/&/g,"&amp;").replace(/</g,"&lt;")+\'</div>\'+(it.note?\'<div class="note">\'+it.note.replace(/&/g,"&amp;").replace(/</g,"&lt;")+\'</div>\':"")+\'</div>\';}\n'+
'document.getElementById("list").innerHTML=h;}\n'+
'var toastTimer;function showTip(t){var el=document.getElementById("toastEl");el.textContent=t;el.style.opacity="1";clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.style.opacity="0"},1500);}\n'+
'window.addEventListener("message",function(e){\n'+
'if(e.data.type==="list"){listData=e.data.items||[];render();}\n'+
'if(e.data.type==="toast"){alert(e.data.text);}\n'+
'});\n'+
'<\/script></body></html>';
  }
}
