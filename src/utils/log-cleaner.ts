/**
 * 一键清理所有日志 — 清理传奇服务端各组件日志
 */
import * as fs from 'fs';
import * as path from 'path';

/** 返回 [删除文件数, 删除目录数, 失败数, 跳过的不存在目录数] */
export async function cleanAllLogs(wsRoot: string): Promise<[number, number, number, number]> {
  // 确保 Windows 盘符路径正确（path.join 会吃掉盘符后的反斜杠）
  const j = (...segs: string[]) => path.resolve(wsRoot, ...segs);
  let filesOk = 0, dirsOk = 0, fail = 0, skip = 0;

  // 清理目录下所有匹配扩展名的文件（不递归，不删目录本身）
  const cleanFiles = (dir: string, exts: string[]) => {
    if (!fs.existsSync(dir)) { skip++; return; }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (exts.includes(ext)) {
          try { fs.unlinkSync(path.join(dir, e.name)); filesOk++; }
          catch { fail++; }
        }
      }
    } catch { fail++; }
  };

  // 递归清理目录下所有匹配扩展名的文件，并删除清理后变空的子目录
  const cleanRecursive = (dir: string, exts: string[]) => {
    if (!fs.existsSync(dir)) { skip++; return; }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) {
          cleanRecursive(fp, exts);
          // 子目录清理完后，如果为空则删除
          try {
            const remaining = fs.readdirSync(fp);
            if (remaining.length === 0) { fs.rmdirSync(fp); dirsOk++; }
          } catch { /* 目录非空或有文件占用，跳过 */ }
        }
        else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (exts.includes(ext)) {
            try { fs.unlinkSync(fp); filesOk++; }
            catch { fail++; }
          }
        }
      }
    } catch { fail++; }
  };

  // ═══════════════════════════════════════════════════════════
  // DBServer\Log\ — 所有 txt 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'DBServer', 'Log'), ['.txt']);

  // ═══════════════════════════════════════════════════════════
  // LoginSrv\ChrLog\ — 递归清理 txt+log，删空目录
  // ═══════════════════════════════════════════════════════════
  cleanRecursive(j( 'LoginSrv', 'ChrLog'), ['.txt', '.log']);

  // ═══════════════════════════════════════════════════════════
  // LoginSrv\CountLog\ — 递归清理 txt，删空目录
  // ═══════════════════════════════════════════════════════════
  cleanRecursive(j( 'LoginSrv', 'CountLog'), ['.txt']);

  // ═══════════════════════════════════════════════════════════
  // LogServer\BaseDir\ — 递归清理 txt+log，删空目录
  // ═══════════════════════════════════════════════════════════
  cleanRecursive(j( 'LogServer', 'BaseDir'), ['.txt', '.log']);

  // ═══════════════════════════════════════════════════════════
  // Mir200\Log\ — 所有 txt 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'Mir200', 'Log'), ['.txt']);

  // ═══════════════════════════════════════════════════════════
  // Mir200\Logs\ — 所有 txt 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'Mir200', 'Logs'), ['.txt']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\Log\ — 所有 txt + log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'Log'), ['.txt', '.log']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\Log(端口数字)\ — 匹配 Log(1) ~ Log(65535)
  // ═══════════════════════════════════════════════════════════
  const runGateDir = j( 'RunGate');
  if (fs.existsSync(runGateDir)) {
    try {
      const logPortRe = /^Log\((\d+)\)$/; // Log(7200) 等
      const entries = fs.readdirSync(runGateDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const m = e.name.match(logPortRe);
        if (m) {
          const port = parseInt(m[1], 10);
          if (port >= 1 && port <= 65535) {
            cleanFiles(path.join(runGateDir, e.name), ['.txt']);
          }
        }
      }
    } catch { skip++; }
  }

  // ═══════════════════════════════════════════════════════════
  // RunGate\NT反外挂系统日志\玩家登录离线日志\ — 所有 log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'NT反外挂系统日志', '玩家登录离线日志'), ['.log']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\NT反外挂系统日志\玩家违规信息日志\ — 所有 log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'NT反外挂系统日志', '玩家违规信息日志'), ['.log']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\NT反外挂系统日志\网关插件加载日志\ — 所有 log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'NT反外挂系统日志', '网关插件加载日志'), ['.log']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\NtProtectLog\Ordinary\ — 所有 log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'NtProtectLog', 'Ordinary'), ['.log']);

  // ═══════════════════════════════════════════════════════════
  // RunGate\NtProtectLog\UserLogon\ — 所有 log 文件
  // ═══════════════════════════════════════════════════════════
  cleanFiles(j( 'RunGate', 'NtProtectLog', 'UserLogon'), ['.log']);

  return [filesOk, dirsOk, fail, skip];
}
