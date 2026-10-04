import * as fs from 'fs';
import * as path from 'path';
import { parseMonGenText } from './map-entities';
import { findEnvirRootForPath } from './quick-files';
import { isPathInside } from './path';

export interface MonsterDropFileTarget {
  sourceFilePath: string;
  envirDirectory: string;
  directoryPath: string;
  monsterName: string;
  filePath: string;
  existingPath?: string;
}

export interface MonGenDropFilePlan {
  sourceFilePath: string;
  envirDirectory: string;
  directoryPath: string;
  targets: MonsterDropFileTarget[];
  duplicateCount: number;
  ignored: Array<{ lineNumber: number; monsterName: string; reason: string }>;
}

export interface MonGenDropFileCreationResult {
  created: string[];
  existing: string[];
  failed: Array<{ monsterName: string; message: string }>;
}

export function isMonGenDocumentPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === 'mongen.txt';
}

/** Preserve a literal monster name; never turn a path/expression into a name. */
export function safeMonsterDropFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || name !== value || name === '.' || name === '..' || name.length > 251
    || /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(name) || /[. ]$/.test(name)
    || /^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(name)
    || /^\$|\$STR\s*\(|(?:^|[^A-Za-z0-9])(?:GL|[NSLD])\$/iu.test(name)) return undefined;
  return name;
}

interface Destination {
  sourceFilePath: string;
  envirDirectory: string;
  directoryPath: string;
  entries: Map<string, string>;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function destinationFor(sourceFilePath: string): Destination | undefined {
  if (!isMonGenDocumentPath(sourceFilePath)) return undefined;
  const source = path.resolve(sourceFilePath);
  const envirDirectory = findEnvirRootForPath(source);
  if (!envirDirectory || !samePath(path.dirname(source), envirDirectory)) return undefined;
  try {
    if (!fs.statSync(envirDirectory).isDirectory()) return undefined;
    const realEnvir = fs.realpathSync(envirDirectory);
    if (fs.existsSync(source) && (!fs.statSync(source).isFile()
      || !isPathInside(realEnvir, fs.realpathSync(source)))) return undefined;
    const matches = fs.readdirSync(envirDirectory).filter(name => name.toLowerCase() === 'monitems');
    if (matches.length > 1) return undefined;
    const directoryPath = path.join(envirDirectory, matches[0] || 'MonItems');
    const entries = new Map<string, string>();
    if (matches.length > 0) {
      if (!fs.statSync(directoryPath).isDirectory()
        || !isPathInside(realEnvir, fs.realpathSync(directoryPath))) return undefined;
      for (const name of fs.readdirSync(directoryPath)) {
        const key = name.toLowerCase();
        // A case-sensitive volume can contain ambiguous names that a Windows
        // client cannot distinguish. Do not select or overwrite either one.
        entries.set(key, entries.has(key) ? '' : path.join(directoryPath, name));
      }
    }
    return { sourceFilePath: source, envirDirectory, directoryPath, entries };
  } catch {
    return undefined;
  }
}

function targetFor(destination: Destination, value: unknown): MonsterDropFileTarget | undefined {
  const monsterName = safeMonsterDropFileName(value);
  if (!monsterName) return undefined;
  const key = `${monsterName}.txt`.toLowerCase();
  const existingPath = destination.entries.get(key);
  if (existingPath === '') return undefined;
  const filePath = existingPath || path.join(destination.directoryPath, `${monsterName}.txt`);
  try {
    if (existingPath && (!fs.statSync(existingPath).isFile()
      || !isPathInside(fs.realpathSync(destination.envirDirectory), fs.realpathSync(existingPath)))) return undefined;
  } catch { return undefined; }
  return { sourceFilePath: destination.sourceFilePath, envirDirectory: destination.envirDirectory,
    directoryPath: destination.directoryPath, monsterName, filePath, ...(existingPath ? { existingPath } : {}) };
}

/** Read-only lookup. It never creates directories or files. */
export function resolveMonsterDropFileTarget(
  sourceFilePath: string,
  monsterName: unknown
): MonsterDropFileTarget | undefined {
  const destination = destinationFor(sourceFilePath);
  return destination && targetFor(destination, monsterName);
}

/** One read-only directory snapshot per document-link query; no write authority. */
export function createMonsterDropFileResolver(
  sourceFilePath: string
): ((monsterName: unknown) => MonsterDropFileTarget | undefined) | undefined {
  const destination = destinationFor(sourceFilePath);
  if (!destination) return undefined;
  const cache = new Map<string, MonsterDropFileTarget | undefined>();
  return value => {
    if (typeof value !== 'string') return undefined;
    const key = value.toLowerCase();
    if (!cache.has(key)) {
      const target = targetFor(destination, value);
      cache.set(key, target && Object.freeze(target));
    }
    return cache.get(key);
  };
}

/** Recheck immediately before/after mkdir, including existing junction targets. */
export function isMonsterDropFileTargetSafe(
  sourceFilePath: string,
  monsterName: unknown,
  filePath: string
): boolean {
  const target = resolveMonsterDropFileTarget(sourceFilePath, monsterName);
  return !!target && samePath(target.filePath, filePath);
}

/** Parse the current editor text, not another server or a stale disk document. */
export function buildMonGenDropFilePlan(sourceFilePath: string, text: string): MonGenDropFilePlan {
  const destination = destinationFor(sourceFilePath);
  if (!destination) throw new Error('只能在当前 MonGen.txt 所属的安全 Envir/MonItems 目录创建爆率文件');
  const targets: MonsterDropFileTarget[] = [];
  const ignored: MonGenDropFilePlan['ignored'] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const spawn of parseMonGenText(text)) {
    const target = targetFor(destination, spawn.monsterName);
    if (!target) {
      ignored.push({ lineNumber: spawn.lineNumber, monsterName: spawn.monsterName,
        reason: '怪物名不是安全静态文件名，或已有目标存在歧义/越界' });
      continue;
    }
    const key = target.monsterName.toLowerCase();
    if (seen.has(key)) { duplicateCount++; continue; }
    seen.add(key);
    targets.push(target);
  }
  return { sourceFilePath: destination.sourceFilePath, envirDirectory: destination.envirDirectory,
    directoryPath: destination.directoryPath, targets, duplicateCount, ignored };
}

/**
 * Call only after explicit user confirmation. Empty bytes are valid GBK and
 * match createMissingFile: no BOM, no template and no original-file rewrite.
 */
export function createMissingMonGenDropFiles(plan: MonGenDropFilePlan): MonGenDropFileCreationResult {
  const result: MonGenDropFileCreationResult = { created: [], existing: [], failed: [] };
  if (plan.targets.length === 0) return result;
  const destination = destinationFor(plan.sourceFilePath);
  if (!destination || !samePath(destination.envirDirectory, plan.envirDirectory)
    || !samePath(destination.directoryPath, plan.directoryPath)) throw new Error('爆率目录已变化，请重新按 Alt+R');
  const realEnvir = fs.realpathSync(destination.envirDirectory);
  fs.mkdirSync(destination.directoryPath, { recursive: true });
  const realDirectory = fs.realpathSync(destination.directoryPath);
  if (!isPathInside(realEnvir, realDirectory)) throw new Error('拒绝在当前 Envir 以外创建爆率文件');
  for (const planned of plan.targets) {
    try {
      // Never trust a stored target path after the confirmation dialog yields.
      // Recheck canonical boundaries per file without an O(n²) directory scan.
      if (!samePath(fs.realpathSync(destination.envirDirectory), realEnvir)
        || !samePath(fs.realpathSync(destination.directoryPath), realDirectory)
        || (fs.existsSync(plan.sourceFilePath)
          && !isPathInside(realEnvir, fs.realpathSync(plan.sourceFilePath)))) throw new Error('爆率目录已变化，请重新按 Alt+R');
      const target = targetFor(destination, planned.monsterName);
      if (!target || !samePath(target.directoryPath, plan.directoryPath)
        || !samePath(target.filePath, planned.filePath)) throw new Error('爆率目标路径已变化或不安全，请重新按 Alt+R');
      if (target.existingPath) { result.existing.push(target.existingPath); continue; }
      try {
        fs.writeFileSync(target.filePath, '', { encoding: 'utf-8', flag: 'wx' });
        destination.entries.set(path.basename(target.filePath).toLowerCase(), target.filePath);
        result.created.push(target.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!fs.statSync(target.filePath).isFile()
          || !isPathInside(realEnvir, fs.realpathSync(target.filePath))) throw new Error('并发出现的目标不是安全普通文件，未覆盖');
        destination.entries.set(path.basename(target.filePath).toLowerCase(), target.filePath);
        result.existing.push(target.filePath);
      }
    } catch (error) {
      result.failed.push({ monsterName: planned.monsterName, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
