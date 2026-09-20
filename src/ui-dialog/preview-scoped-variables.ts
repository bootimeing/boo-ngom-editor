import { EngineId } from '../types';
import { resolvePreviewExpression, splitPreviewArguments } from './preview-inputs';
import { PreviewVariableKind } from './preview-variable-contracts';

export type PreviewScopedRead = (name: string) => string | undefined;
export type PreviewScopedWrite = (name: string, value: string | undefined, dependencies?: string[]) => void;

function targetName(scope: string, name: string, engine: EngineId): string | undefined {
  const prefix = scope.toUpperCase();
  const scopes = engine === 'GOM' ? ['HUMAN'] : ['HUMAN', 'GLOBAL', 'GUILD'];
  return scopes.includes(prefix) && /^[A-Za-z0-9_\u3400-\u9fff]+$/.test(name) ? `${prefix}(${name})` : undefined;
}

function integer(value: string | undefined): bigint | undefined {
  if (value === undefined || value.length > 4096 || !/^[+-]?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

/**
 * Pure local support for the scoped custom-variable commands evidenced by each
 * engine's 自定义变量功能 chapter (996PC additionally 新自定义变量).
 * LOADVAR is intentionally an unknown runtime write; SAVEVAR performs no I/O.
 * A handled but unevaluable write invalidates its old value instead of retaining
 * stale display data. No output can carry a database/resource capability.
 */
export function executePreviewScopedVariableCommand(
  command: string,
  rest: string,
  read: PreviewScopedRead,
  write: PreviewScopedWrite,
  engine: EngineId = 'GOM',
  kindFor?: (name: string) => PreviewVariableKind | undefined
): boolean {
  const cmd = command.toUpperCase();
  if (!['VAR', 'CALCVAR', 'LOADVAR', 'SAVEVAR'].includes(cmd)) return false;
  const parts = splitPreviewArguments(rest);
  const declaration = cmd === 'VAR';
  const target = targetName(parts[declaration ? 1 : 0] || '', parts[declaration ? 2 : 1] || '', engine);
  if (!target) return false;
  if (declaration) {
    // 996PC permits a fourth merge-mode argument; it is not an initial value.
    const validLength = parts.length === 3 || (engine === '996PC' && parts.length === 4 && /^[0-7]$/.test(parts[3]));
    const type = parts[0].toUpperCase();
    if (!validLength || !['INTEGER', 'STRING'].includes(type) || (engine === 'GOM' && type !== 'INTEGER')) return false;
    if (read(target) === undefined) write(target, type === 'INTEGER' ? '0' : '', []);
    return true;
  }
  if (cmd === 'LOADVAR' || cmd === 'SAVEVAR') {
    // 996PC also supports database persistence without a file argument.
    if (parts.length !== 3 && !(engine === '996PC' && parts.length === 2)) return false;
    if (cmd === 'LOADVAR') write(target, undefined, []);
    return true;
  }
  if (parts.length !== 4) { write(target, undefined, []); return true; }
  const op = parts[2];
  const allowed = engine === 'GOM' ? ['+', '-'] : engine === 'GEE' ? ['+', '-', '='] : ['+', '-', '=', '*', '/'];
  if (!allowed.includes(op)) { write(target, undefined, []); return true; }
  const dependencies = new Set<string>();
  const tracedRead: PreviewScopedRead = name => { dependencies.add(name); return read(name); };
  const right = resolvePreviewExpression(parts[3], tracedRead, engine);
  const kind = kindFor?.(target);
  if (op === '=') {
    write(target, kind === 'number' && integer(right) === undefined ? undefined : right, [...dependencies]);
    return true;
  }
  dependencies.add(target);
  const leftValue = tracedRead(target);
  // String concatenation via CALCVAR is not evidenced; only String '=' is.
  if (kind === 'text') { write(target, undefined, [...dependencies]); return true; }
  const left = integer(leftValue), rightInt = integer(right);
  if (left === undefined || rightInt === undefined) { write(target, undefined, [...dependencies]); return true; }
  const result = op === '+' ? left + rightInt : op === '-' ? left - rightInt : op === '*' ? left * rightInt
    : rightInt === 0n || left % rightInt !== 0n ? undefined : left / rightInt;
  // The manuals do not prove how a fractional integer-division result rounds.
  // Exact division is safe; a remainder stays unknown instead of guessing.
  const value = result?.toString();
  write(target, value && value.length <= 4096 ? value : undefined, [...dependencies]);
  return true;
}
