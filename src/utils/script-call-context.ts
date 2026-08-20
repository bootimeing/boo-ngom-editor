import * as fs from 'fs';
import * as path from 'path';
import { findScriptCommandPathReferences, resolveScriptPathReference } from './path';
import { findScriptLabelDefinitions } from './script-labels';
import { decodeTextFile } from './text';

interface HostIndexCache {
  signature: string;
  labelsByTarget: Map<string, Set<string>>;
}

const hostIndexCache = new Map<string, HostIndexCache>();

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
}

function candidateHostFiles(workspaceRoot: string): string[] {
  return [
    'Mir200/Envir/Market_Def/QFunction-0.txt',
    'Envir/Market_Def/QFunction-0.txt',
    'Mir200/Envir/MapQuest_def/QManage.txt',
    'Envir/MapQuest_def/QManage.txt',
    'Mir200/Envir/Robot_def/RobotManage.txt',
    'Envir/Robot_def/RobotManage.txt',
  ].map(relativePath => path.join(workspaceRoot, ...relativePath.split('/')))
    .filter(filePath => fs.existsSync(filePath));
}

function hostSignature(hostFiles: string[]): string {
  return hostFiles.map(filePath => {
    const stat = fs.statSync(filePath);
    return `${normalizeFilePath(filePath)}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');
}

function buildHostIndex(workspaceRoot: string, hostFiles: string[]): Map<string, Set<string>> {
  const labelsByTarget = new Map<string, Set<string>>();
  for (const hostFile of hostFiles) {
    const text = decodeTextFile(fs.readFileSync(hostFile)).text;
    const lines = text.split(/\r\n|\n|\r/);
    const hostLabels = new Set(findScriptLabelDefinitions(lines).map(definition => definition.key));
    for (const line of lines) {
      const callReferences = findScriptCommandPathReferences(line)
        .filter(reference => reference.kind === 'scriptCall');
      for (const reference of callReferences) {
        const resolution = resolveScriptPathReference(
          workspaceRoot,
          hostFile,
          reference.path,
          'questDiary'
        );
        if (!resolution.existingPath) continue;
        const key = normalizeFilePath(resolution.existingPath);
        const labels = labelsByTarget.get(key) || new Set<string>();
        for (const label of hostLabels) labels.add(label);
        labelsByTarget.set(key, labels);
      }
    }
  }
  return labelsByTarget;
}

export function findHostScriptLabelKeys(
  workspaceRoot: string,
  targetFile: string
): ReadonlySet<string> {
  if (!/[\\/]Envir[\\/]QuestDiary[\\/]/i.test(targetFile)) return new Set();
  const hostFiles = candidateHostFiles(workspaceRoot);
  if (hostFiles.length === 0) return new Set();
  const signature = hostSignature(hostFiles);
  const cacheKey = normalizeFilePath(workspaceRoot);
  let cached = hostIndexCache.get(cacheKey);
  if (!cached || cached.signature !== signature) {
    cached = {
      signature,
      labelsByTarget: buildHostIndex(workspaceRoot, hostFiles),
    };
    hostIndexCache.set(cacheKey, cached);
  }
  return cached.labelsByTarget.get(normalizeFilePath(targetFile)) || new Set();
}

export function clearScriptCallContextCache(): void {
  hostIndexCache.clear();
}
