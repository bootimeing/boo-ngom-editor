import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decodeTextFile } from './text';

export interface PakPasswordRecord {
  configuredPath: string;
  password: string;
  configPath: string;
  option?: string;
}

export type PakPasswordErrorKind = 'confirmed' | 'ambiguous' | 'none';

export function pakPasswordSecretKey(pakPath: string): string {
  const normalized = path.resolve(pakPath).toLowerCase();
  return 'boo.pak.password.' + crypto.createHash('sha256').update(normalized).digest('hex');
}

export function patchPasswordSecretKey(pakPath: string): string {
  const normalized = path.resolve(pakPath).toLowerCase();
  return 'boo.patch.password.' + crypto.createHash('sha256').update(normalized).digest('hex');
}

export function classifyPakPasswordError(error: unknown): PakPasswordErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : '';
  if (
    errorName === 'JpkPasswordError'
    || /密码错误\s*[，,、/]?\s*或/i.test(message)
    || /密码(?:未通过验证|可能错误)|密码或(?:资源|文件|格式|索引)/i.test(message)
    || /password[^\r\n]{0,32}\bor\b[^\r\n]{0,32}(?:format|file|index)/i.test(message)
  ) {
    return 'ambiguous';
  }
  if (
    /(?:password is incorrect|incorrect password|wrong password|password mismatch|password verification failed)/i.test(message)
    || /(?:密码不正确|密码校验失败|密码验证失败|密码错误)(?:[。.!！]?\s*)$/i.test(message)
  ) {
    return 'confirmed';
  }
  return 'none';
}

export function isPakPasswordError(error: unknown): boolean {
  return classifyPakPasswordError(error) !== 'none';
}

export function isConfirmedPakPasswordError(error: unknown): boolean {
  return classifyPakPasswordError(error) === 'confirmed';
}

export function selectPakPassword(
  suppliedPassword?: string,
  configuredPassword?: string,
  savedPassword?: string
): string | undefined {
  return [suppliedPassword, configuredPassword, savedPassword]
    .find(value => value !== undefined && value !== '');
}

export function readPakPasswordRecords(configPath: string): PakPasswordRecord[] {
  const text = decodePakPasswordFile(fs.readFileSync(configPath));
  const records: PakPasswordRecord[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const firstSeparator = rawLine.indexOf('|');
    if (firstSeparator <= 0) continue;
    const configuredPath = unquote(rawLine.slice(0, firstSeparator));
    let passwordField = rawLine.slice(firstSeparator + 1);
    let option: string | undefined;
    const lastSeparator = passwordField.lastIndexOf('|');
    if (lastSeparator >= 0) {
      const possibleOption = unquote(passwordField.slice(lastSeparator + 1));
      if (/^[01]$/.test(possibleOption)) {
        option = possibleOption;
        passwordField = passwordField.slice(0, lastSeparator);
      }
    }
    const password = unquote(passwordField);
    if (!configuredPath || !password || !/\.(?:pak|jpk)$/i.test(configuredPath)) continue;
    records.push({ configuredPath, password, configPath, option });
  }
  return records;
}

export function resolvePakPasswordFromRecords(
  records: PakPasswordRecord[],
  pakPath: string,
  dataDirectory?: string
): string | undefined {
  const resolvedPakPath = path.resolve(pakPath);
  const pakPathKey = normalizeAbsolutePath(resolvedPakPath);
  const pakBasename = path.basename(resolvedPakPath).toLowerCase();
  const dataRoot = dataDirectory ? path.resolve(dataDirectory) : path.dirname(resolvedPakPath);
  const relativePakPath = normalizeRelativePath(path.relative(dataRoot, resolvedPakPath));
  const matches: Array<{ score: number; password: string }> = [];

  for (const record of records) {
    const configuredPath = normalizeConfiguredPath(record.configuredPath);
    const resolvedConfiguredPath = path.resolve(path.dirname(record.configPath), configuredPath);
    let score = 0;

    if (normalizeAbsolutePath(resolvedConfiguredPath) === pakPathKey) {
      score = 4;
    } else {
      const rebasedPath = rebaseConfiguredPakPath(configuredPath, dataRoot);
      if (normalizeAbsolutePath(rebasedPath) === pakPathKey) {
        score = 3;
      } else if (!path.isAbsolute(configuredPath)) {
        const configuredRelative = stripLeadingDataDirectory(configuredPath);
        if (normalizeRelativePath(configuredRelative) === relativePakPath) score = 2;
      }
    }

    if (score === 0 && path.basename(configuredPath).toLowerCase() === pakBasename) score = 1;
    if (score > 0) matches.push({ score, password: record.password });
  }

  if (matches.length === 0) return undefined;
  const bestScore = Math.max(...matches.map(match => match.score));
  const passwords = new Set(matches.filter(match => match.score === bestScore).map(match => match.password));
  return passwords.size === 1 ? [...passwords][0] : undefined;
}

export function rebaseConfiguredPakPath(
  configuredPath: string,
  dataDirectory: string
): string {
  const normalized = normalizeConfiguredPath(configuredPath);
  const dataTail = pathAfterDataDirectory(normalized);
  if (dataTail) return path.resolve(dataDirectory, dataTail);
  if (!path.isAbsolute(normalized)) {
    return path.resolve(dataDirectory, stripLeadingDataDirectory(normalized));
  }
  return path.resolve(dataDirectory, path.basename(normalized));
}

export function findPasswordInPakConfig(
  pakPath: string,
  configPath: string,
  dataDirectory?: string
): string | undefined {
  try {
    return resolvePakPasswordFromRecords(readPakPasswordRecords(configPath), pakPath, dataDirectory);
  } catch (error) {
    console.warn('[BOO] 资源密码文件读取失败:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export function findPasswordInPakTxt(pakPath: string, workspaceRoot?: string): string | undefined {
  const candidates: string[] = [];
  const appendConfigFiles = (directory: string) => {
    candidates.push(path.join(directory, 'Pak.txt'));
    candidates.push(path.join(directory, 'JpkList.txt'));
  };
  let current = path.dirname(path.resolve(pakPath));
  for (let depth = 0; depth < 4; depth++) {
    appendConfigFiles(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (workspaceRoot) {
    const resolvedWorkspace = path.resolve(workspaceRoot);
    const workspaceCandidates = [resolvedWorkspace];
    if (path.basename(resolvedWorkspace).toLowerCase() === 'mir200') {
      workspaceCandidates.push(path.dirname(resolvedWorkspace));
    } else {
      workspaceCandidates.push(path.join(resolvedWorkspace, 'Mirserver'));
    }
    for (const root of uniquePaths(workspaceCandidates)) {
      appendConfigFiles(root);
      candidates.push(path.join(root, '登录器生成器', 'JpkList.txt'));
    }
  }

  const records: PakPasswordRecord[] = [];
  for (const configPath of uniquePaths(candidates)) {
    if (!fs.existsSync(configPath)) continue;
    try {
      records.push(...readPakPasswordRecords(configPath));
    } catch (error) {
      console.warn('[BOO] 资源密码文件读取失败:', error instanceof Error ? error.message : String(error));
    }
  }
  return resolvePakPasswordFromRecords(records, pakPath);
}

function normalizeAbsolutePath(filePath: string): string {
  return path.normalize(path.resolve(filePath)).toLowerCase();
}

function normalizeConfiguredPath(filePath: string): string {
  return filePath.replace(/[\\/]+/g, path.sep);
}

function normalizeRelativePath(filePath: string): string {
  return filePath
    .replace(/[\\/]+/g, path.sep)
    .replace(new RegExp(`^\\.${escapeRegExp(path.sep)}+`), '')
    .toLowerCase();
}

function pathAfterDataDirectory(filePath: string): string | undefined {
  const parts = normalizeConfiguredPath(filePath).split(path.sep).filter(Boolean);
  let dataIndex = -1;
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].toLowerCase() === 'data') dataIndex = index;
  }
  return dataIndex >= 0 && dataIndex < parts.length - 1
    ? parts.slice(dataIndex + 1).join(path.sep)
    : undefined;
}

function stripLeadingDataDirectory(filePath: string): string {
  const parts = normalizeConfiguredPath(filePath).split(path.sep).filter(part => part && part !== '.');
  if (parts[0]?.toLowerCase() === 'data') parts.shift();
  return parts.join(path.sep);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter(filePath => {
    const key = normalizeAbsolutePath(filePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function decodePakPasswordFile(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString('utf16le');
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const littleEndian = Buffer.from(raw.subarray(2));
    for (let index = 0; index + 1 < littleEndian.length; index += 2) {
      const first = littleEndian[index];
      littleEndian[index] = littleEndian[index + 1];
      littleEndian[index + 1] = first;
    }
    return littleEndian.toString('utf16le');
  }
  return decodeTextFile(raw).text;
}
