export const WORKSPACE_SCRIPT_AUDIT_DIRECTORIES = [
  'MapQuest_Def',
  'Market_Def',
  'QuestDiary',
  'Robot_def',
] as const;

const auditedDirectories = new Set(
  WORKSPACE_SCRIPT_AUDIT_DIRECTORIES.map(directory => directory.toLowerCase())
);

export function isWorkspaceScriptAuditPath(filePath: string): boolean {
  const parts = String(filePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (!parts.length || !parts[parts.length - 1].toLowerCase().endsWith('.txt')) return false;
  for (let index = 0; index < parts.length - 1; index++) {
    if (parts[index].toLowerCase() !== 'envir') continue;
    const directory = parts[index + 1]?.toLowerCase();
    if (directory && auditedDirectories.has(directory)) return true;
  }
  return false;
}

export function workspaceScriptAuditGlobs(): string[] {
  return WORKSPACE_SCRIPT_AUDIT_DIRECTORIES.map(
    directory => `**/Envir/${directory}/**/*.txt`
  );
}
