import * as path from 'path';
import { parseTableColumns } from './table-configs';
import { parseMapInfoText } from './map-preview';
import {
  findScriptCommandInvocations,
  isMapParameterDescription,
  ScriptTextSpan,
} from './command-arguments';

export interface CommandParameterInfo {
  params: string[];
  completionVerified?: boolean;
}

type CommandResolver<T extends CommandParameterInfo> = (typedName: string) => T | undefined;

export function collectConfiguredMapCodes(mapInfoText: string): Set<string> {
  const result = new Set<string>();
  for (const entry of parseMapInfoText(mapInfoText)) {
    result.add(normalizeMapCode(entry.mapId));
    result.add(normalizeMapCode(entry.originalMapId));
  }
  result.delete('');
  return result;
}

export function findMapCodeRangesInLine<T extends CommandParameterInfo>(
  line: string,
  filePath: string,
  configuredMapCodes: ReadonlySet<string>,
  resolveCommand: CommandResolver<T>
): ScriptTextSpan[] {
  if (configuredMapCodes.size === 0 || !/[A-Za-z0-9_\u4e00-\u9fff]/.test(line)) return [];
  const result: ScriptTextSpan[] = [];
  const fileName = path.basename(filePath).toLowerCase();
  const columns = parseTableColumns(line);

  if (fileName === 'mapinfo.txt' || fileName === 'mapinfo') {
    const closing = line.indexOf(']');
    if (closing >= 0) addConfiguredCodes(line, 0, closing + 1, configuredMapCodes, result);
  } else if (fileName === 'minimap.txt' || fileName === 'minimap') {
    addColumnCode(line, columns[0], configuredMapCodes, result);
  } else if (fileName === 'merchant.txt' || fileName === 'merchant') {
    addColumnCode(line, columns[1], configuredMapCodes, result);
  } else if (fileName === 'mongen.txt' || fileName === 'mongen') {
    addColumnCode(line, columns[0], configuredMapCodes, result);
  } else if (/^mapdesc.*\.txt$/i.test(fileName)) {
    const comma = line.indexOf(',');
    if (comma > 0) addConfiguredCodes(line, 0, comma, configuredMapCodes, result);
  }

  for (const invocation of findScriptCommandInvocations(line, resolveCommand)) {
    if (invocation.command.completionVerified !== true) continue;
    for (let index = 0; index < invocation.arguments.length; index++) {
      const parameter = invocation.command.params[index];
      if (!parameter || !isMapParameterDescription(parameter)) continue;
      const argument = invocation.arguments[index];
      addConfiguredCodes(line, argument.start, argument.end, configuredMapCodes, result);
    }
  }

  return uniqueRanges(result);
}

export function findMapCodeRangesInText<T extends CommandParameterInfo>(
  text: string,
  filePath: string,
  configuredMapCodes: ReadonlySet<string>,
  resolveCommand: CommandResolver<T>
): ScriptTextSpan[] {
  const result: ScriptTextSpan[] = [];
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(text)) !== null) {
    if (!match[0]) break;
    const line = match[0].replace(/[\r\n]+$/, '');
    for (const range of findMapCodeRangesInLine(
      line,
      filePath,
      configuredMapCodes,
      resolveCommand
    )) {
      result.push({
        start: match.index + range.start,
        end: match.index + range.end,
        text: range.text,
      });
    }
  }
  return result;
}

export function isOffsetInTextRanges(offset: number, ranges: readonly ScriptTextSpan[]): boolean {
  return ranges.some(range => range.start <= offset && offset < range.end);
}

function addColumnCode(
  line: string,
  column: { start: number; end: number } | undefined,
  configuredMapCodes: ReadonlySet<string>,
  target: ScriptTextSpan[]
): void {
  if (column) addConfiguredCodes(line, column.start, column.end, configuredMapCodes, target);
}

function addConfiguredCodes(
  line: string,
  start: number,
  end: number,
  configuredMapCodes: ReadonlySet<string>,
  target: ScriptTextSpan[]
): void {
  const pattern = /[A-Za-z0-9_\-\u4e00-\u9fff]+/g;
  const source = line.slice(start, end);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (!configuredMapCodes.has(normalizeMapCode(match[0]))) continue;
    const absoluteStart = start + match.index;
    target.push({
      start: absoluteStart,
      end: absoluteStart + match[0].length,
      text: match[0],
    });
  }
}

function uniqueRanges(ranges: ScriptTextSpan[]): ScriptTextSpan[] {
  const seen = new Set<string>();
  return ranges.filter(range => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.start - right.start);
}

function normalizeMapCode(value: string): string {
  return value.trim().toUpperCase();
}
