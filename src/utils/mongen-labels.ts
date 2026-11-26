import { EngineId } from '../types';
import { parseMonGenLine } from './map-entities';
import { normalizeStaticDirectCallbackLabel } from './script-labels';

export interface MonGenQFunctionReference {
  label: string;
  start: number;
  end: number;
}

// Help-verified spawn callbacks: GOM/996PC column 10, LFM/GEE column 15.
// GOM column 18's 1@RespawnAlert:... belongs to QMapEvent, not QFunction.
const QFUNCTION_COLUMN: Readonly<Record<EngineId, number>> = { GOM: 9, GEE: 14, '996PC': 9 };

/** Only the complete static QF field is navigable; spans are half-open. */
export function findMonGenQFunctionReferenceAt(
  lineText: string,
  character: number,
  engine: EngineId
): MonGenQFunctionReference | undefined {
  const parsed = parseMonGenLine(lineText, 1);
  if (!parsed) return undefined;
  const columnIndex = QFUNCTION_COLUMN[engine];
  const column = parsed.columns[columnIndex];
  if (!column || character < column.start || character >= column.end) return undefined;

  // Table tokenization retains tail columns. A comment marker before the
  // callback is ambiguous even when attached to a previous cell: do not
  // navigate possible comment text as the missing callback column.
  if (parsed.columns.slice(0, columnIndex + 1).some(item => item.value.includes(';') || item.value.includes('//'))) return undefined;
  const label = normalizeStaticDirectCallbackLabel(column.value);
  if (label === undefined) return undefined;
  return { label, start: column.start, end: column.end };
}
