import * as fs from 'fs';
import * as path from 'path';
import { findAtLabelTokenAt, isScriptCommentLine } from './script-labels';

export interface ScriptLabelPosition {
  line: number;
  character: number;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
