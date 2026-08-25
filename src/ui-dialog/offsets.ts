import { NpcDialogOffsets } from './model';

export function parseNpcDialogOffsets(
  setupText: string,
  setupPath?: string
): NpcDialogOffsets {
  const memoX = readInteger(setupText, 'NpcMemoOffSetX');
  const memoY = readInteger(setupText, 'NpcMemoOffSetY');
  const menuX = readInteger(setupText, 'NpcMenuListOffSetX');
  const menuY = readInteger(setupText, 'NpcMenuListOffSetY');
  const configured = memoX !== undefined || memoY !== undefined;
  return {
    memoX: memoX ?? 0,
    memoY: memoY ?? 0,
    menuX: menuX ?? 0,
    menuY: menuY ?? 0,
    source: configured ? 'setup' : 'default',
    configured,
    setupPath,
  };
}

export function workspaceNpcDialogOffsets(
  memoX: number,
  memoY: number
): NpcDialogOffsets {
  return {
    memoX: normalizeInteger(memoX),
    memoY: normalizeInteger(memoY),
    menuX: 0,
    menuY: 0,
    source: 'workspace',
    configured: true,
  };
}

function readInteger(text: string, key: string): number | undefined {
  const expression = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*([+-]?\\d+)`, 'im');
  const match = expression.exec(text);
  return match ? normalizeInteger(Number(match[1])) : undefined;
}

function normalizeInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
