import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 8765;

interface BridgeHealth {
  reachable: boolean;
  ok: boolean;
  pakEngine?: boolean;
  error?: string;
}

let ownedBridge: ChildProcess | undefined;
let ownedBridgePid: number | undefined;
let bridgeStartPromise: Promise<void> | undefined;
let bridgeOutput = '';

export async function ensureGmBridge(context: vscode.ExtensionContext): Promise<void> {
  const health = await probeBridge();
  if (health.ok) return;
  if (health.reachable) {
    if (!health.pakEngine) {
      throw new Error(`本机端口 ${BRIDGE_PORT} 已被其他程序占用${health.error ? `: ${health.error}` : ''}`);
    }
    await stopUnhealthyBridge();
  }
  if (!bridgeStartPromise) {
    bridgeStartPromise = startBundledBridge(context).finally(() => {
      bridgeStartPromise = undefined;
    });
  }
  await bridgeStartPromise;
}

async function stopUnhealthyBridge(): Promise<void> {
  try { await requestBridgeShutdown(); } catch { /* report the still-running service below */ }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await probeBridge()).reachable) return;
    await delay(100);
  }
  throw new Error(`无法停止端口 ${BRIDGE_PORT} 上的旧 PAK 服务，请先手动关闭后重试`);
}

export async function disposeGmBridge(): Promise<void> {
  if (!ownedBridge) return;
  try {
    await requestBridgeShutdown();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (await probeBridge()).reachable) await delay(100);
  } catch {
    // Fall through to cleanup of the process owned by this extension.
  }
  if ((await probeBridge()).reachable && ownedBridgePid) {
    try { process.kill(ownedBridgePid); } catch { /* already stopped */ }
  }
  ownedBridge.stdout?.destroy();
  ownedBridge.stderr?.destroy();
  if (ownedBridge.exitCode === null) ownedBridge.kill();
  ownedBridge.unref();
  ownedBridge = undefined;
  ownedBridgePid = undefined;
}

async function startBundledBridge(context: vscode.ExtensionContext): Promise<void> {
  const binDir = context.asAbsolutePath(path.join('tools', 'PakBridge', 'bin'));
  const bridgePath = path.join(binDir, 'boo-pak-bridge.exe');
  if (!fs.existsSync(bridgePath)) throw new Error(`扩展缺少 PAK 离线引擎: ${bridgePath}`);

  const requiredRuntimeFiles = ['python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
  const missingRuntimeFiles = requiredRuntimeFiles.filter(fileName => !fs.existsSync(path.join(binDir, fileName)));
  if (missingRuntimeFiles.length > 0) {
    throw new Error(`扩展缺少 PAK 离线引擎运行库: ${missingRuntimeFiles.join(', ')}，请重新安装完整扩展包`);
  }

  const bridgeEnv = { ...process.env };
  const pathKey = Object.keys(bridgeEnv).find(key => key.toLowerCase() === 'path') || 'Path';
  bridgeEnv[pathKey] = [binDir, path.join(binDir, 'lib'), bridgeEnv[pathKey]]
    .filter((entry): entry is string => Boolean(entry))
    .join(path.delimiter);

  bridgeOutput = '';
  let spawnError: Error | undefined;
  ownedBridge = spawn(bridgePath, [
    'serve', '--host', BRIDGE_HOST, '--port', String(BRIDGE_PORT),
  ], {
    cwd: binDir,
    env: bridgeEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedBridgePid = ownedBridge.pid;
  const collectOutput = (chunk: Buffer | string) => {
    bridgeOutput = (bridgeOutput + chunk.toString()).slice(-8000);
  };
  ownedBridge.stdout?.on('data', collectOutput);
  ownedBridge.stderr?.on('data', collectOutput);
  ownedBridge.once('error', error => { spawnError = error; });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const health = await probeBridge();
    if (health.ok) {
      vscode.window.setStatusBarMessage('PAK 离线引擎已在后台就绪', 5000);
      return;
    }
    if (spawnError) {
      resetOwnedBridge();
      throw new Error(`PAK 离线引擎启动失败: ${spawnError.message}`);
    }
    if (ownedBridge.exitCode !== null) {
      const exitCode = ownedBridge.exitCode;
      resetOwnedBridge();
      const exitReason = (exitCode >>> 0) === 0xC0000135
        ? '，Windows 未找到所需 DLL，请重新安装完整扩展包'
        : '';
      throw new Error(`PAK 离线引擎启动失败 (退出码 ${exitCode}${exitReason})${bridgeOutput ? `: ${bridgeOutput.trim()}` : ''}`);
    }
    await delay(200);
  }
  ownedBridge.kill();
  resetOwnedBridge();
  throw new Error(`等待 PAK 离线引擎启动超时${bridgeOutput ? `: ${bridgeOutput.trim()}` : ''}`);
}

function resetOwnedBridge() {
  ownedBridge = undefined;
  ownedBridgePid = undefined;
}

function requestBridgeShutdown(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: '/api/shutdown',
      method: 'POST',
      timeout: 1500,
      headers: { 'Content-Length': '0' },
    }, response => {
      response.resume();
      response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${response.statusCode || 0}`)));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

function probeBridge(): Promise<BridgeHealth> {
  return new Promise(resolve => {
    const request = http.get({ hostname: BRIDGE_HOST, port: BRIDGE_PORT, path: '/api/health', timeout: 1500 }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            ok?: boolean;
            engine?: string;
            gmProcessRequired?: boolean;
            formats?: string[];
            error?: string;
          };
          const serverHeader = String(response.headers.server || '');
          const pakEngine = serverHeader.startsWith('PakOfflineEngine/')
            || serverHeader.startsWith('GMLocalBridge/')
            || result.engine === 'offline';
          const supportsGee2 = Array.isArray(result.formats)
            && result.formats.includes('GEEPAK2');
          const validBuild = result.engine === 'offline'
            && result.gmProcessRequired === false
            && supportsGee2;
          resolve({
            reachable: true,
            ok: response.statusCode === 200 && result.ok === true && validBuild,
            pakEngine,
            error: result.error || (!validBuild ? 'PAK 服务版本过旧或不是当前离线版本' : undefined),
          });
        } catch {
          resolve({ reachable: true, ok: false, pakEngine: false, error: '端口响应不是 PAK 离线引擎' });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve({ reachable: false, ok: false }));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
