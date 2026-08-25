/**
 * DeepSeek Harness 入口（v4.3.3）
 *
 * 左侧活动栏最下方鲸鱼图标 → 点击后在右侧拆分编辑器（WebviewPanel，ViewColumn.Beside）内嵌本地 dsh web。
 *
 * 运行时策略（用户定版）：只用 DeepSeekHarness.exe（自解压便携版，安装到 %LOCALAPPDATA%\DeepSeekHarnessPortable）。
 * - 检测到已安装（或扩展此前解压的运行时）→ 用内置 node.exe 以 dsh web --port 0 启动（自动空闲端口），
 *   从 stdout 解析就绪行拿到真实地址；DSH_HOME 指向扩展全局存储（与 exe 自带 home 隔离，用户自填 Key）。
 * - 未检测到 → 弹提示去 QQ 交流群 58505745 下载 DeepSeekHarness.exe 并运行一次。
 * - 已配置地址（boo.deepseek.host:port）在线则直接复用（与浏览器共享实例），不重复启动。
 * - 安全边界：扩展自身绝不直接 fetch /api；面板内 iframe 同源加载 harness 界面。
 */
import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { secureWebviewHtml } from '../utils/webview-security';

const PROBE_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 1500;
const START_POLL_MS = 1000;
const START_POLL_ROUNDS = 15;
const PANEL_VIEW_TYPE = 'boo.deepseekPanel';
const URL_LINE_RE = /dsh web: (http:\/\/[0-9a-zA-Z.]+:\d+)/;
/** 用户下载 DeepSeekHarness.exe 的交流群 */
const DSH_GROUP_QQ = '58505745';

/** 解码子进程输出：Windows 中文系统 cmd/npm 输出多为 GBK，UTF-8 出现替换符时回退 GBK */
function decodeOutput(buf: Buffer): string {
  let text = buf.toString('utf8');
  if (text.indexOf('\uFFFD') >= 0) {
    try {
      const iconv = require('iconv-lite');
      const alt = iconv.decode(buf, 'gbk');
      if (alt.indexOf('\uFFFD') < 0) { text = alt; }
    } catch { /* 保留 UTF-8 结果 */ }
  }
  return text;
}

/** 合并 PATH 后返回子进程环境（把已知的 node 目录追加进去；可选 DSH_HOME） */
function childEnv(extraDirs: string[], dshHome?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const parts = [
    ...(env.Path || env.PATH || '').split(';').filter(Boolean),
    ...extraDirs.filter(Boolean),
  ];
  const joined = Array.from(new Set(parts)).join(';');
  env.Path = joined;
  env.PATH = joined;
  if (dshHome) { env.DSH_HOME = dshHome; }
  return env;
}

interface DeepSeekTarget {
  host: string;
  port: number;
  url: string;
}

export function getDeepSeekTarget(): DeepSeekTarget {
  const cfg = vscode.workspace.getConfiguration('boo');
  let host = String(cfg.get<string>('deepseek.host', '127.0.0.1')).trim();
  // 只接受裸主机名/IP：非法字符会注入 CSP（如 host/path）导致整个 webview 白屏
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) { host = '127.0.0.1'; }
  let port = Number(cfg.get<number>('deepseek.port', 3080));
  if (!Number.isFinite(port) || port <= 0 || port > 65535) { port = 3080; }
  return { host, port, url: 'http://' + host + ':' + port };
}

export function probeDeepSeekServer(baseUrl: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    const req = http.get(baseUrl + '/', { timeout: PROBE_TIMEOUT_MS }, res => {
      res.resume();
      finish((res.statusCode ?? 0) < 500);
    });
    req.on('error', () => finish(false));
    req.on('timeout', () => { req.destroy(); finish(false); });
  });
}

// ============ 运行时解析（只用 DeepSeekHarness.exe 安装） ============

let _extUri: vscode.Uri | undefined;
let _extContext: vscode.ExtensionContext | undefined;

interface BundledRuntime { nodeExe: string; binJs: string; }

/** 扩展自己的运行目录（兼容旧版本在此解压的历史数据） */
function runtimeRoot(): string | undefined {
  return _extContext ? path.join(_extContext.globalStorageUri.fsPath, 'deepseek-harness-runtime') : undefined;
}

/** 扩展自己的 DSH_HOME（会话/Key 持久化，与 exe 自带 home 隔离） */
function portableHomePath(): string | undefined {
  return _extContext ? path.join(_extContext.globalStorageUri.fsPath, 'deepseek-harness-home') : undefined;
}

/** 运行时候选目录：%LOCALAPPDATA%\DeepSeekHarnessPortable（exe 安装位置）+ 扩展存储（历史数据） */
function runtimeRoots(): string[] {
  const roots: string[] = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) { roots.push(path.join(localAppData, 'DeepSeekHarnessPortable')); }
  const own = runtimeRoot();
  if (own) { roots.push(own); }
  return roots;
}

/** 已安装的便携运行时（node.exe + dsh/lib/bin.js），任意候选目录命中即用 */
function resolveBundledRuntime(): BundledRuntime | undefined {
  for (const root of runtimeRoots()) {
    const nodeExe = path.join(root, 'node.exe');
    const binJs = path.join(root, 'dsh', 'lib', 'bin.js');
    if (fs.existsSync(nodeExe) && fs.existsSync(binJs)) { return { nodeExe, binJs }; }
  }
  return undefined;
}

/** 未检测到运行时 → 提示去交流群下载 DeepSeekHarness.exe */
async function promptJoinGroupDownload(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    '未检测到 DeepSeek Harness。请到 QQ 交流群 ' + DSH_GROUP_QQ +
    ' 下载 DeepSeekHarness.exe 并运行一次，然后重新打开本面板。',
    { modal: true },
    '复制群号'
  );
  if (choice === '复制群号') { await vscode.env.clipboard.writeText(DSH_GROUP_QQ); }
}

/** 用内置 node.exe 启动 dsh web --port 0，从 stdout 解析就绪 URL；返回 URL 或 undefined */
function spawnAndWaitUrl(nodeExe: string, binJs: string, host: string): Promise<string | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (url?: string) => { if (!settled) { settled = true; resolve(url); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(nodeExe, [binJs, '--profile', 'web', '--host', host, '--port', '0'], {
        windowsHide: true,
        env: childEnv([path.dirname(nodeExe)], portableHomePath()),
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      finish(undefined);
      return;
    }
    let buffer = '';
    child.stdout?.on('data', (d: Buffer) => {
      buffer = (buffer + decodeOutput(d)).slice(-4000);
      const m = buffer.match(URL_LINE_RE);
      if (m && m[1]) {
        child.unref();
        finish(m[1]);
      }
    });
    child.on('error', () => finish(undefined));
    child.on('close', () => finish(undefined));
    setTimeout(() => { child.unref(); finish(undefined); }, START_POLL_MS * START_POLL_ROUNDS);
  });
}

// ============ 右侧编辑器面板 + 左侧迷你启动卡 ============

let _panel: vscode.WebviewPanel | undefined;
let _sidebar: vscode.WebviewView | undefined;
let _timer: ReturnType<typeof setInterval> | undefined;
let _online = false;
let _starting = false;
let _activeUrl: string | undefined;

function liveWebviews(): vscode.Webview[] {
  const list: vscode.Webview[] = [];
  if (_panel) { list.push(_panel.webview); }
  if (_sidebar) { list.push(_sidebar.webview); }
  return list;
}

function postAll(type: string, payload: Record<string, unknown> = {}): void {
  for (const webview of liveWebviews()) { void webview.postMessage({ type, ...payload }); }
}

function ensureProbe(): void {
  if (_timer) { return; }
  _timer = setInterval(() => { void probeTick(); }, PROBE_INTERVAL_MS);
}

function stopProbeIfIdle(): void {
  if (!_panel && !_sidebar && _timer) { clearInterval(_timer); _timer = undefined; }
}

function currentUrl(): string {
  const target = getDeepSeekTarget();
  return _activeUrl ?? target.url;
}

async function refreshStatus(): Promise<void> {
  const url = currentUrl();
  const online = await probeDeepSeekServer(url);
  _online = online;
  postAll('status', { online, starting: _starting, url, dshAvailable: !!resolveBundledRuntime() });
}

async function probeTick(): Promise<void> {
  const url = currentUrl();
  const online = await probeDeepSeekServer(url);
  const changed = online !== _online;
  _online = online;
  if (changed) {
    postAll('status', { online, starting: _starting, url });
    if (online && _starting) {
      _starting = false;
      void vscode.window.showInformationMessage('DeepSeek Harness 已启动: ' + url);
    }
  }
}

/** 点击图标 = 启动服务：已配置地址在线则复用；有运行时则拉起；都没有 → 提示去群下载 */
async function autoStart(): Promise<void> {
  const target = getDeepSeekTarget();
  if (await probeDeepSeekServer(target.url)) {
    _activeUrl = target.url;
    _online = true;
    postAll('status', { online: true, starting: false, url: target.url, dshAvailable: true });
    return;
  }
  const bundled = resolveBundledRuntime();
  if (!bundled) {
    _online = false;
    postAll('status', { online: false, starting: false, url: target.url, dshAvailable: false });
    await promptJoinGroupDownload();
    return;
  }
  if (_starting) { return; }
  _starting = true;
  postAll('status', { online: _online, starting: true, url: target.url, dshAvailable: true });
  const spawned = await spawnAndWaitUrl(bundled.nodeExe, bundled.binJs, target.host);
  _starting = false;
  if (spawned) {
    _activeUrl = spawned;
    _online = true;
    postAll('status', { online: true, starting: false, url: spawned, dshAvailable: true });
  } else {
    _online = false;
    postAll('status', { online: false, starting: false, url: target.url, dshAvailable: true });
    void vscode.window.showWarningMessage(
      'DeepSeek 服务未能在 15 秒内启动。请确认 DeepSeekHarness.exe 已安装并运行过一次。'
    );
  }
}

function buildFrameSrcs(): string[] {
  const { host } = getDeepSeekTarget();
  return Array.from(new Set([
    'http://127.0.0.1:*',
    'http://localhost:*',
    'http://' + host + ':*',
  ]));
}

/** 右侧编辑器面板：iframe + 居中提示（单例复用，关闭后可重开） */
export function ensureDeepSeekPanel(): vscode.WebviewPanel {
  if (_panel) { _panel.reveal(vscode.ViewColumn.Beside); return _panel; }
  _panel = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    'DeepSeek',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  if (_extUri) {
    _panel.iconPath = vscode.Uri.joinPath(_extUri, 'resources', 'deepseek-icon.svg');
  }
  _panel.webview.html = secureWebviewHtml(_panel.webview, panelHtml(), { frameSrc: buildFrameSrcs() });
  _panel.webview.onDidReceiveMessage(msg => {
    if (msg && (msg as Record<string, unknown>).type === 'probe') { void refreshStatus(); }
  });
  _panel.onDidDispose(() => { _panel = undefined; stopProbeIfIdle(); });
  ensureProbe();
  void autoStart();
  return _panel;
}

/** 命令：boo.deepseek.openPanel —— 在右侧拆分编辑器打开 DeepSeek */
export function openDeepSeekPanelCommand(): void {
  ensureDeepSeekPanel();
}

/** 命令：boo.deepseek.openInBrowser —— 探测后打开浏览器，离线时提供启动选项 */
export async function openDeepSeekInBrowser(): Promise<void> {
  const target = getDeepSeekTarget();
  const existing = _activeUrl ?? (await probeDeepSeekServer(target.url) ? target.url : undefined);
  if (existing) {
    await vscode.env.openExternal(vscode.Uri.parse(existing));
    return;
  }
  const bundled = resolveBundledRuntime();
  if (!bundled) {
    await promptJoinGroupDownload();
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    'DeepSeek 服务未运行（' + target.url + '）。',
    '启动并打开',
    '仅打开浏览器'
  );
  if (choice === '启动并打开') {
    const url = await spawnAndWaitUrl(bundled.nodeExe, bundled.binJs, target.host);
    if (url) {
      _activeUrl = url;
      _online = true;
      postAll('status', { online: true, starting: false, url, dshAvailable: true });
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } else {
      void vscode.window.showWarningMessage('DeepSeek 服务未能在 15 秒内启动。');
    }
  } else if (choice === '仅打开浏览器') {
    await vscode.env.openExternal(vscode.Uri.parse(target.url));
  }
}

/** 命令：boo.deepseek.startServer —— 仅启动服务，不打开浏览器 */
export async function startDeepSeekServerCommand(): Promise<void> {
  const target = getDeepSeekTarget();
  if (await probeDeepSeekServer(target.url)) {
    void vscode.window.showInformationMessage('DeepSeek 服务已在运行: ' + target.url);
    return;
  }
  const bundled = resolveBundledRuntime();
  if (!bundled) {
    await promptJoinGroupDownload();
    return;
  }
  void vscode.window.showInformationMessage('正在启动 DeepSeek Harness…');
  const url = await spawnAndWaitUrl(bundled.nodeExe, bundled.binJs, target.host);
  if (url) {
    _activeUrl = url;
    _online = true;
    postAll('status', { online: true, starting: false, url, dshAvailable: true });
    void vscode.window.showInformationMessage('DeepSeek Harness 已启动: ' + url);
  } else {
    void vscode.window.showWarningMessage('DeepSeek 服务未能在 15 秒内启动。');
  }
}

/** 左侧迷你启动卡（WebviewViewProvider） */
export class DeepSeekViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'boo.deepseekView';

  constructor(context: vscode.ExtensionContext) {
    _extUri = context.extensionUri;
    _extContext = context;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    _sidebar = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(msg => {
      const type = msg && (msg as Record<string, unknown>).type;
      if (type === 'probe') { void refreshStatus(); }
      if (type === 'openPanel') { ensureDeepSeekPanel(); }
    });
    webviewView.onDidDispose(() => { _sidebar = undefined; stopProbeIfIdle(); });
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) { return; }
      if (_panel) { _panel.reveal(vscode.ViewColumn.Beside); }
      else { ensureDeepSeekPanel(); }
    });
    webviewView.webview.html = secureWebviewHtml(webviewView.webview, sidebarHtml());
    ensureProbe();
    void refreshStatus();
    // 点击图标 → 自动在右侧拆分编辑器打开 harness
    ensureDeepSeekPanel();
  }
}

function panelHtml(): string {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%}' +
    'body{display:flex;flex-direction:column;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-size:12px}' +
    '#frameWrap{flex:1;position:relative}' +
    'iframe{position:absolute;inset:0;width:100%;height:100%;border:none;background:#fff}' +
    '#overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:var(--vscode-sideBar-background);text-align:center;padding:20px}' +
    '#overlay.hidden{display:none}' +
    '.hint{color:var(--vscode-descriptionForeground,#999);font-size:12px;line-height:1.6;max-width:340px}' +
    '</style></head><body>' +
    '<div id="frameWrap">' +
    '<iframe id="frame" src="about:blank"></iframe>' +
    '<div id="overlay"><div class="hint" id="hintText">正在检测 DeepSeek 服务…</div></div>' +
    '</div>' +
    '<script>' +
    'var v=acquireVsCodeApi();' +
    'var overlay=document.getElementById("overlay");' +
    'var hint=document.getElementById("hintText");' +
    'var frame=document.getElementById("frame");' +
    'function setStatus(s){' +
    '  var online=s.online&&!s.starting;' +
    '  overlay.classList.toggle("hidden",online);' +
    '  if(s.starting){hint.textContent="正在启动 DeepSeek 服务…";}' +
    '  else if(!s.online&&!s.dshAvailable){hint.textContent="未检测到 DeepSeek Harness。请到 QQ 交流群 58505745 下载 DeepSeekHarness.exe 并运行一次。"}' +
    '  else if(!s.online){hint.textContent="DeepSeek 服务未运行。面板会自动检测，服务恢复后立即加载。"}' +
    '  if(online&&s.url&&frame.getAttribute("src")!==s.url){frame.setAttribute("src",s.url);}' +
    '}' +
    'window.addEventListener("message",function(e){var m=e.data;if(!m||typeof m!=="object")return;if(m.type==="status")setStatus(m);});' +
    'v.postMessage({type:"probe"});' +
    '</script></body></html>';
}

function sidebarHtml(): string {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{padding:10px;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-size:12px}' +
    'h3{font-size:12px;color:#00d4ff;margin-bottom:8px}' +
    '.status{color:var(--vscode-descriptionForeground,#999);margin-bottom:10px;line-height:1.5}' +
    'button{width:100%;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:6px 0;cursor:pointer;font-size:12px}' +
    'button:hover{background:var(--vscode-button-hoverBackground)}' +
    '.tip{color:var(--vscode-descriptionForeground,#999);font-size:11px;margin-top:8px;line-height:1.5}' +
    '</style></head><body>' +
    '<h3>🐳 DeepSeek</h3>' +
    '<div class="status" id="status">检测中…</div>' +
    '<button id="btnOpen">在右侧打开 DeepSeek</button>' +
    '<div class="tip">首次使用请先运行 DeepSeekHarness.exe（QQ 交流群 58505745 下载）。</div>' +
    '<script>' +
    'var v=acquireVsCodeApi();' +
    'var statusEl=document.getElementById("status");' +
    'document.getElementById("btnOpen").addEventListener("click",function(){v.postMessage({type:"openPanel"});});' +
    'window.addEventListener("message",function(e){var m=e.data;if(!m||typeof m!=="object")return;if(m.type==="status"){statusEl.textContent=m.starting?("正在启动 …"):m.online?("服务在线 "+m.url):(m.dshAvailable===false?"未检测到 Harness（群 58505745 下载）":"服务未运行");}});' +
    'v.postMessage({type:"probe"});' +
    '</script></body></html>';
}
