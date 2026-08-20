import * as fs from 'fs';
import * as path from 'path';
import {
  NestedConfigValueRequest,
  NestedConfigValueResult,
  NestedListDataRequest,
  NestedListDataResult,
  NestedTableDataRequest,
  NestedTableDataResult,
  NestedVariableAnalysisOptions,
} from './nested-variable-analysis';
import { decodeTextFile } from './text';
import { isBinarySpreadsheet, parseScriptTableData } from './table-data';
import { openXlsTable } from './xls-table';

type IniSections = Map<string, Map<string, string[]>>;

interface CachedValue<T> {
  stamp: string;
  value: T | undefined;
}

export class ScriptDataResolver {
  private readonly configs = new Map<string, CachedValue<IniSections>>();
  private readonly tables = new Map<string, CachedValue<NestedTableDataResult>>();
  private readonly lists = new Map<string, CachedValue<NestedListDataResult>>();

  optionsFor(sourceFile: string): NestedVariableAnalysisOptions {
    return {
      resolveConfigValues: request => this.resolveConfig(sourceFile, request),
      resolveTableData: request => this.resolveTable(sourceFile, request),
      resolveListData: request => this.resolveList(sourceFile, request),
    };
  }

  private resolveConfig(
    sourceFile: string,
    request: NestedConfigValueRequest,
  ): NestedConfigValueResult | undefined {
    const configPath = this.resolveDataFile(sourceFile, request.path);
    if (!configPath) return undefined;
    const sections = this.cachedFile(this.configs, configPath, raw => (
      parseIniSections(decodeTextFile(raw).text)
    ));
    if (!sections) return undefined;

    const sectionExpression = stripQuotes(request.section);
    const keyExpression = stripQuotes(request.key);
    const dynamicSection = /<\$/i.test(sectionExpression);
    const dynamicKey = /<\$/i.test(keyExpression);
    const selectedSections = dynamicSection
      ? [...sections.values()]
      : [sections.get(sectionExpression.trim().toUpperCase())]
        .filter((section): section is Map<string, string[]> => section !== undefined);
    if (selectedSections.length === 0) return undefined;

    const values = dynamicKey
      ? selectedSections.flatMap(section => [...section.values()].flat())
      : selectedSections.flatMap(section => (
        section.get(keyExpression.trim().toUpperCase()) || []
      ));
    if (values.length === 0) return undefined;
    return {
      values,
      complete: !dynamicSection && !dynamicKey,
    };
  }

  private resolveTable(
    sourceFile: string,
    request: NestedTableDataRequest,
  ): NestedTableDataResult | undefined {
    const tablePath = this.resolveDataFile(sourceFile, request.path);
    if (!tablePath) return undefined;
    const cacheKey = `${request.format}:${tablePath}`;
    return this.cachedFile(this.tables, cacheKey, raw => {
      if (isBinarySpreadsheet(raw)) {
        return { rows: openXlsTable(Buffer.from(raw)).rows, complete: true };
      }
      return {
        rows: parseScriptTableData(decodeTextFile(raw).text, request.format),
        complete: true,
      };
    }, tablePath);
  }

  private resolveList(
    sourceFile: string,
    request: NestedListDataRequest,
  ): NestedListDataResult | undefined {
    const listPath = this.resolveDataFile(sourceFile, request.path);
    if (!listPath) return undefined;
    return this.cachedFile(this.lists, listPath, raw => ({
      lines: decodeTextFile(raw).text.split(/\r\n|\n|\r/),
      complete: true,
    }));
  }

  private resolveDataFile(sourceFile: string, rawPath: string): string | undefined {
    if (!rawPath || /<\$/i.test(rawPath)) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const relativePath = stripQuotes(rawPath);
    const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
    const candidates = path.isAbsolute(relativePath)
      ? [path.resolve(relativePath)]
      : [
        path.resolve(path.dirname(sourceFile), relativePath),
        path.resolve(envirRoot, 'Market_Def', relativePath),
        path.resolve(envirRoot, relativePath),
        path.resolve(envirRoot, withoutParentPrefix),
      ];
    return uniquePaths(candidates).find(isFile);
  }

  private cachedFile<T>(
    cache: Map<string, CachedValue<T>>,
    cacheKey: string,
    parse: (raw: Uint8Array) => T,
    filePath = cacheKey,
  ): T | undefined {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return undefined;
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = cache.get(cacheKey);
    if (cached?.stamp === stamp) return cached.value;
    let value: T | undefined;
    try {
      value = parse(fs.readFileSync(filePath));
    } catch {
      value = undefined;
    }
    cache.set(cacheKey, { stamp, value });
    return value;
  }
}

function parseIniSections(text: string): IniSections {
  const sections: IniSections = new Map();
  let current: Map<string, string[]> | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toUpperCase();
      current = sections.get(name) || new Map<string, string[]>();
      sections.set(name, current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toUpperCase();
    const values = current.get(key) || [];
    values.push(line.slice(separator + 1).trim());
    current.set(key, values);
  }
  return sections;
}

function findAncestorDirectory(filePath: string, directoryName: string): string | undefined {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(current).toUpperCase() === directoryName.toUpperCase()) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function uniquePaths(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
