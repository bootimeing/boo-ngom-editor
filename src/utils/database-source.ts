import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseProfile } from './database-browser';
import { decodeTextFile } from './text';

export interface WorkspaceDatabaseSource {
  path: string;
  profile: DatabaseProfile;
  source: 'setup' | 'unique-file' | '996pc';
  description: string;
  setupPath?: string;
  configurationKey?: string;
}

/**
 * Automatic workspace discovery must choose a source, not merge every DB/MDB
 * beside it. Backups have arbitrary names and may be perfectly valid databases.
 * A manual file selection deliberately bypasses this resolver.
 */
export function resolveWorkspaceDatabaseSource(
  engineRoot: string,
  profile: DatabaseProfile = 'legacy'
): WorkspaceDatabaseSource {
  const serverRoot = path.resolve(engineRoot);
  const mirDirectory = existingCaseInsensitivePath(path.join(serverRoot, 'Mir200'))
    || path.join(serverRoot, 'Mir200');
  if (profile === '996pc') {
    const directory = existingCaseInsensitivePath(path.join(mirDirectory, 'Envir', 'Data'))
      || path.join(mirDirectory, 'Envir', 'Data');
    return { path: directory, profile, source: '996pc', description: '996PC · Envir/Data' };
  }

  const setupPath = existingCaseInsensitivePath(path.join(mirDirectory, '!Setup.txt'));
  const config = setupPath ? readSetupServerSection(setupPath) : new Map<string, string>();
  const mode = config.get('useaccessdb');
  if (mode !== undefined && mode !== '') {
    if (mode === '3') {
      return configuredFile(config.get('sqlitefilename'), 'SqliteFileName', '.db');
    }
    throw new Error(
      `!Setup.txt 的 UseAccessDB=${mode} 当前不能自动打开；请使用“打开数据库”选择受支持的 DB/MDB 文件。`
    );
  }

  // Some older configurations omit the selector. A single explicit supported
  // file setting is still usable; conflicting settings must never be guessed.
  const explicit = [
    { key: 'SqliteFileName', value: config.get('sqlitefilename'), extension: '.db' },
    { key: 'AccessFileName', value: config.get('accessfilename'), extension: '.mdb' },
  ].filter(setting => Boolean(setting.value));
  if (explicit.length > 1 || (explicit.length && config.get('excelfilename'))) {
    throw new Error('!Setup.txt 配置了多个数据库来源，但缺少 UseAccessDB；无法确定服务端实际使用的数据库。');
  }
  if (explicit.length === 1) {
    return configuredFile(explicit[0].value, explicit[0].key, explicit[0].extension);
  }
  if (config.get('excelfilename')) {
    throw new Error('!Setup.txt 指向 Excel 数据库，当前传统引擎数据库编辑器不能自动打开该格式。');
  }

  const directory = existingCaseInsensitivePath(path.join(serverRoot, 'MUD2', 'db'));
  const candidates = directory && fs.statSync(directory).isDirectory()
    ? fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(?:db|mdb)$/i.test(entry.name))
      .map(entry => path.join(directory, entry.name))
    : [];
  const name = config.get('dbname');
  if (name) {
    const matches = candidates.filter(file => path.parse(file).name.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return selected(matches[0], 'setup', '!Setup.txt · DBName', 'DBName');
    throw new Error(matches.length > 1
      ? `!Setup.txt 的 DBName=${name} 对应多个 DB/MDB 文件，请明确配置数据库路径。`
      : `未找到 !Setup.txt 的 DBName=${name} 对应的 DB/MDB 文件；不会改用其他数据库或备份。`);
  }
  if (candidates.length === 1) return selected(candidates[0], 'unique-file', '工作区唯一数据库');
  if (candidates.length > 1) {
    throw new Error('工作区发现多个 DB/MDB 文件，可能包含备份。请在 Mir200/!Setup.txt 指定数据库，或使用“打开数据库”选择文件。');
  }
  throw new Error('未找到工作区数据库，请检查 Mir200/!Setup.txt 和 MUD2/db，或使用“打开数据库”选择文件。');

  function configuredFile(value: string | undefined, key: string, extension: string): WorkspaceDatabaseSource {
    if (!value) throw new Error(`!Setup.txt 未填写当前数据库模式对应的 ${key}；不会扫描或打开其他数据库。`);
    if (path.extname(value).toLowerCase() !== extension) {
      throw new Error(`!Setup.txt 的 ${key} 应指向 ${extension.toUpperCase()} 文件；请检查数据库模式和路径。`);
    }
    const absolute = path.isAbsolute(value);
    const roots = absolute ? [value] : [path.resolve(mirDirectory, value), path.resolve(serverRoot, value)];
    const matches = uniqueFiles(roots.map(existingCaseInsensitivePath).filter((file): file is string => Boolean(file)));
    if (!matches.length) {
      throw new Error(`!Setup.txt 指定的数据库不存在：${key}=${value}；不会改用备份数据库。`);
    }
    if (matches.length > 1) {
      throw new Error(`!Setup.txt 的相对路径 ${key}=${value} 对应多个文件，请改为明确的绝对路径。`);
    }
    const file = matches[0];
    if (!fs.statSync(file).isFile()) throw new Error(`!Setup.txt 的 ${key} 必须指向数据库文件。`);
    return selected(file, 'setup', `!Setup.txt · ${key}`, key);
  }

  function selected(
    file: string,
    source: WorkspaceDatabaseSource['source'],
    description: string,
    configurationKey?: string
  ): WorkspaceDatabaseSource {
    return {
      path: fs.realpathSync(file), profile: 'legacy', source, description,
      ...(setupPath ? { setupPath } : {}), ...(configurationKey ? { configurationKey } : {}),
    };
  }
}

function readSetupServerSection(file: string): Map<string, string> {
  const result = new Map<string, string>();
  let server = false;
  for (const raw of decodeTextFile(fs.readFileSync(file)).text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || /^(?:;|#|\/\/)/.test(line)) continue;
    const section = /^\[([^\]]+)\]/.exec(line);
    if (section) { server = section[1].trim().toLowerCase() === 'server'; continue; }
    if (!server) continue;
    const equal = line.indexOf('=');
    if (equal < 1) continue;
    const key = line.slice(0, equal).trim().toLowerCase();
    if (!['useaccessdb', 'sqlitefilename', 'accessfilename', 'excelfilename', 'dbname'].includes(key)) continue;
    const rawValue = line.slice(equal + 1).trim();
    const value = unquoteConfigurationValue(rawValue);
    if (result.has(key) && result.get(key) !== value) {
      throw new Error(`!Setup.txt 的 ${key} 存在冲突配置，无法确定数据库来源。`);
    }
    result.set(key, value);
  }
  return result;
}

function unquoteConfigurationValue(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.indexOf(quote, 1);
    if (end < 0 || !/^(?:\s*(?:;|\/\/).*)?$/.test(value.slice(end + 1))) {
      throw new Error('!Setup.txt 的数据库路径引号或行尾格式无效。');
    }
    return value.slice(1, end).trim();
  }
  // Preserve semicolons within filenames; only whitespace-separated comments
  // are removed. A configured missing file is never a reason to scan a backup.
  return value.replace(/\s+(?:;|\/\/).*$/, '').trim();
}

function existingCaseInsensitivePath(candidate: string): string | undefined {
  if (fs.existsSync(candidate)) return path.resolve(candidate);
  const resolved = path.resolve(candidate);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) return undefined;
    const matches = fs.readdirSync(current).filter(name => name.toLowerCase() === segment.toLowerCase());
    if (matches.length !== 1) return undefined;
    current = path.join(current, matches[0]);
  }
  return fs.existsSync(current) ? current : undefined;
}

function uniqueFiles(files: readonly string[]): string[] {
  const seen = new Set<string>();
  return files.filter(file => {
    const key = fs.realpathSync(file).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
