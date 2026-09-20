import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { decodeTextFile, PreservedTextEncoding } from '../utils/text';

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;

/** Context is selected by a source-authored directive, never inferred from a filename. */
export type PreviewScriptSourcePurpose = 'questdiary-txt' | 'defines-ini' | 'questdiary-constants-ini';

export interface PreviewScriptSource {
  uri: string;
  fileName: string;
  filePath: string;
  documentVersion: number;
  text: string;
  encoding?: PreservedTextEncoding;
  /** Exact disk bytes, present only when this read used the file rather than an open buffer. */
  sha256?: string;
  /** Recomputed UTF-8 text identity on every successful read, including unsaved buffers. */
  textSha256?: string;
}

export type PreviewScriptSourceResolution =
  | { status: 'found'; source: PreviewScriptSource; candidateFilePaths: string[] }
  | { status: 'missing' | 'blocked' | 'ambiguous'; message: string; candidateFilePaths: string[] };

interface PathSnapshot {
  entries: { filePath: string; stat: fs.Stats }[];
  file?: fs.Stats;
}

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

/** A leading single slash is the engine's QuestDiary root, not a filesystem root. */
function relativeParts(rawPath: string, extension: 'txt' | 'ini'): string[] | undefined {
  if (!rawPath || rawPath.length > 4096 || rawPath !== rawPath.trim()
    || /^[\\/]{2}/.test(rawPath) || /[\u0000-\u001f\u007f<>:"|?*\[\]{}$%]/.test(rawPath)) return undefined;
  const relative = rawPath.replace(/^[\\/]/, '');
  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(part))) return undefined;
  return parts[parts.length - 1].toLowerCase().endsWith(`.${extension}`) ? parts : undefined;
}

/** Check every existing component, including the workspace root and its real identity. */
function inspectPath(workspaceRoot: string, target: string): PathSnapshot {
  const relative = path.relative(workspaceRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('脚本路径不在工作区内');
  }
  const entries: PathSnapshot['entries'] = [];
  const names = [workspaceRoot];
  let current = workspaceRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    names.push(current);
  }
  for (let index = 0; index < names.length; index++) {
    const filePath = names[index];
    let stat: fs.Stats;
    try { stat = fs.lstatSync(filePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && index > 0) return { entries };
      throw error;
    }
    if (stat.isSymbolicLink() || pathKey(fs.realpathSync(filePath)) !== pathKey(filePath)) {
      throw new Error('不读取符号链接、目录联接或重定向路径');
    }
    if (index < names.length - 1 && !stat.isDirectory()) throw new Error('脚本父路径不是目录');
    if (index === names.length - 1 && (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error('脚本目标必须是非硬链接的普通文件');
    }
    entries.push({ filePath, stat });
  }
  return { entries, file: entries[entries.length - 1].stat };
}

function sameSnapshot(left: PathSnapshot, right: PathSnapshot): boolean {
  return left.entries.length === right.entries.length
    && left.entries.every((entry, index) => pathKey(entry.filePath) === pathKey(right.entries[index].filePath)
      && sameIdentity(entry.stat, right.entries[index].stat));
}

function matchesSource(source: PreviewScriptSource, candidate: string): boolean {
  if (typeof source.filePath === 'string' && path.isAbsolute(source.filePath)
    && pathKey(source.filePath) === pathKey(candidate)) return true;
  try {
    const uri = new URL(source.uri);
    return uri.protocol === 'file:' && pathKey(fileURLToPath(uri)) === pathKey(candidate);
  } catch { return false; }
}

function validSourceIdentity(source: PreviewScriptSource, candidate: string): boolean {
  try {
    const uri = new URL(source.uri);
    return typeof source.filePath === 'string' && path.isAbsolute(source.filePath)
      && pathKey(source.filePath) === pathKey(candidate)
      && uri.protocol === 'file:' && !uri.host && !uri.search && !uri.hash
      && pathKey(fileURLToPath(uri)) === pathKey(candidate)
      && Number.isSafeInteger(source.documentVersion) && source.documentVersion >= 0
      && typeof source.text === 'string' && !source.text.includes('\0')
      && Buffer.byteLength(source.text, 'utf8') <= MAX_SCRIPT_BYTES;
  } catch { return false; }
}

/**
 * Resolve a source-authored CALL path below the own-engine QuestDiary directory.
 * This performs bounded, read-only text access. It does not execute scripts or
 * grant the resulting source an editable route into the primary NPC document.
 */
export function resolvePreviewScriptSource(
  workspaceRoot: string,
  rawPath: string,
  openSources: readonly PreviewScriptSource[] = [],
  purpose: PreviewScriptSourcePurpose = 'questdiary-txt',
): PreviewScriptSourceResolution {
  let candidateFilePaths: string[] = [];
  const reject = (status: 'missing' | 'blocked' | 'ambiguous', message: string): PreviewScriptSourceResolution =>
    ({ status, message, candidateFilePaths });
  if (!['questdiary-txt', 'defines-ini', 'questdiary-constants-ini'].includes(purpose)) {
    return reject('blocked', '没有确认的脚本源读取用途');
  }
  const directory = purpose === 'defines-ini' ? 'Defines' : 'QuestDiary';
  const extension = purpose === 'questdiary-txt' ? 'txt' : 'ini';
  const parts = relativeParts(rawPath, extension);
  if (!parts) return reject('blocked', `${purpose} 仅允许 ${directory} 内不含变量、跳级或设备别名的静态 ${extension.toUpperCase()} 路径`);
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot) || /^[\\/]{2}/.test(workspaceRoot)
    || /[\u0000-\u001f]/.test(workspaceRoot)) return reject('blocked', '工作区必须是确定的本地绝对目录');
  const root = path.resolve(workspaceRoot);
  const envirRoots = [path.join(root, 'Mir200', 'Envir'), path.join(root, 'Envir')];
  if (path.basename(root).toLowerCase() === 'envir') envirRoots.push(root);
  candidateFilePaths = [...new Set(envirRoots.map(envir => path.join(envir, directory, ...parts)))];
  try {
    const candidates = candidateFilePaths.map(filePath => ({ filePath, snapshot: inspectPath(root, filePath),
      opened: openSources.filter(source => matchesSource(source, filePath)) }));
    const stableCandidates = () => candidates.every(candidate =>
      sameSnapshot(candidate.snapshot, inspectPath(root, candidate.filePath)));
    for (const candidate of candidates) {
      if (candidate.opened.length > 1) return reject('ambiguous', '同一外部脚本有多个打开文档来源，不能选择任一版本');
      if (candidate.opened.some(source => !validSourceIdentity(source, candidate.filePath))) {
        return reject('blocked', '打开脚本的 URI、路径、版本或文本大小不满足安全读取约束');
      }
    }
    const existing = candidates.filter(candidate => candidate.snapshot.file || candidate.opened.length);
    if (!existing.length) return reject('missing', `没有找到标准 ${directory} 外部脚本`);
    if (existing.length > 1) return reject('ambiguous', `多个 Envir/${directory} 均包含目标脚本，不能擅自选择`);
    const selected = existing[0];
    const filePath = selected.filePath;
    if (selected.opened.length) {
      if (!stableCandidates()) return reject('blocked', '打开文档读取期间文件身份发生变化');
      return { status: 'found', candidateFilePaths, source: { ...selected.opened[0], filePath,
        fileName: path.basename(filePath), uri: pathToFileURL(filePath).toString(), sha256: undefined,
        textSha256: createHash('sha256').update(selected.opened[0].text, 'utf8').digest('hex') } };
    }
    if (!selected.snapshot.file || selected.snapshot.file.size > MAX_SCRIPT_BYTES) {
      return reject('blocked', '外部脚本超出 2 MiB 本地读取上限');
    }
    const handle = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(handle);
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_SCRIPT_BYTES
        || !sameIdentity(selected.snapshot.file, before)) return reject('blocked', '打开外部脚本时文件身份发生变化');
      // Never let a concurrent grow allocate an unbounded buffer/readFileSync result.
      const raw = Buffer.alloc(MAX_SCRIPT_BYTES + 1);
      let length = 0;
      while (length < raw.length) {
        const read = fs.readSync(handle, raw, length, raw.length - length, null);
        if (!read) break;
        length += read;
      }
      if (length > MAX_SCRIPT_BYTES || length !== before.size
        || !sameIdentity(before, fs.fstatSync(handle))
        || !stableCandidates()) {
        return reject('blocked', '外部脚本在读取期间变更或超出 2 MiB 上限');
      }
      const bytes = raw.subarray(0, length);
      if (bytes.includes(0)) return reject('blocked', '脚本含 NUL/二进制或不支持的 UTF-16 内容');
      const decoded = decodeTextFile(bytes);
      return { status: 'found', candidateFilePaths, source: { filePath, fileName: path.basename(filePath),
        uri: pathToFileURL(filePath).toString(), documentVersion: 0, ...decoded,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        textSha256: createHash('sha256').update(decoded.text, 'utf8').digest('hex') } };
    } finally { fs.closeSync(handle); }
  } catch (error) {
    return reject('blocked', `外部脚本无法安全读取：${error instanceof Error ? error.message : String(error)}`);
  }
}
