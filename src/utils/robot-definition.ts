import * as fs from 'fs';
import * as path from 'path';
import { findAtLabelTokenAt, isScriptCommentLine } from './script-labels';

export interface ScriptLabelPosition {
  line: number;
  character: number;
}

export interface LoadedScriptLabelCandidate<T> {
  value: T;
  text: string;
}

export interface ResolvedScriptLabelCandidate<T> {
  value: T;
  position: ScriptLabelPosition;
}

const AUTO_RUN_FILE = 'autorunrobot.txt';
const ROBOT_MANAGE_FILE = 'robotmanage.txt';
const ROBOT_DIRECTORY = 'robot_def';

export function isAutoRunRobotFile(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === AUTO_RUN_FILE
    && path.basename(path.dirname(filePath)).toLowerCase() === ROBOT_DIRECTORY;
}

export function findAutoRunRobotLabelAt(
  filePath: string,
  lineText: string,
  character: number
): string | undefined {
  if (!isAutoRunRobotFile(filePath) || isScriptCommentLine(lineText)) return undefined;

  return findAtLabelTokenAt(lineText, character);
}

export function resolveRobotManageFile(autoRunFilePath: string): string | undefined {
  if (!isAutoRunRobotFile(autoRunFilePath)) return undefined;
  const directory = path.dirname(autoRunFilePath);
  const exactPath = path.join(directory, 'RobotManage.txt');
  if (fs.existsSync(exactPath)) return exactPath;

  try {
    const matchingName = fs.readdirSync(directory, { withFileTypes: true })
      .find(entry => entry.isFile() && entry.name.toLowerCase() === ROBOT_MANAGE_FILE)
      ?.name;
    return matchingName ? path.join(directory, matchingName) : undefined;
  } catch {
    return undefined;
  }
}

export function findScriptLabelPosition(
  text: string,
  label: string
): ScriptLabelPosition | undefined {
  const labelRegex = new RegExp(
    `^[\\t \\uFEFF]*\\[@${escapeRegex(label)}\\]`,
    'im'
  );
  const match = labelRegex.exec(text);
  if (!match) return undefined;

  const bracketOffset = text.indexOf('[@', match.index);
  const before = text.slice(0, bracketOffset);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: (before.match(/\n/g) || []).length,
    character: bracketOffset - lastNewline - 1,
  };
}

/**
 * 在候选顺序中选定首个可读取文件，并只在该文件中解析标签。
 * 首个文件存在但标签缺失时立即结束，避免回退到另一套服务端的同名文件。
 */
export async function findScriptLabelInFirstAvailableCandidate<T>(
  candidates: readonly string[],
  label: string,
  loadCandidate: (
    candidate: string
  ) => Promise<LoadedScriptLabelCandidate<T> | undefined>
): Promise<ResolvedScriptLabelCandidate<T> | undefined> {
  for (const candidate of candidates) {
    const loaded = await loadCandidate(candidate);
    if (!loaded) continue;
    const position = findScriptLabelPosition(loaded.text, label);
    return position ? { value: loaded.value, position } : undefined;
  }
  return undefined;
}

/**
 * 优先在主文件中解析标签；只有主文件缺失或标签缺失时才惰性加载回退候选。
 * 回退阶段收集所有命中，并严格保持候选输入顺序。
 */
export async function findScriptLabelInPrimaryOrFallbackCandidates<T>(
  primaryCandidate: string,
  loadFallbackCandidates: () => Promise<readonly string[]>,
  label: string,
  loadCandidate: (
    candidate: string
  ) => Promise<LoadedScriptLabelCandidate<T> | undefined>
): Promise<ResolvedScriptLabelCandidate<T>[]> {
  const primary = await loadCandidate(primaryCandidate);
  if (primary) {
    const position = findScriptLabelPosition(primary.text, label);
    if (position) return [{ value: primary.value, position }];
  }

  const results: ResolvedScriptLabelCandidate<T>[] = [];
  const fallbackCandidates = await loadFallbackCandidates();
  for (const candidate of fallbackCandidates) {
    const loaded = await loadCandidate(candidate);
    if (!loaded) continue;
    const position = findScriptLabelPosition(loaded.text, label);
    if (position) results.push({ value: loaded.value, position });
  }
  return results;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
