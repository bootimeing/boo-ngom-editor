import { EngineId } from '../types';
import { parseMonGenLine } from './map-entities';
import { findScriptCommandCallbackReferences, isScriptCommentLine, normalizeStaticDirectCallbackLabel } from './script-labels';

export interface EngineFileCallback {
  label: string;
  target: 'QManage.txt' | 'QFunction-0.txt' | 'QMapEvent-0.txt';
  start: number;
  end: number;
  strict?: boolean;
}

/** Static fields with a documented file target. All offsets refer to the unmodified line. */
export function engineFileCallbacks(line: string, filename: string, engine: EngineId, action: boolean): EngineFileCallback[] {
  if (isScriptCommentLine(line)) return [];
  const clean = line.replace(/(?:^|\s)(?:;|\/\/).*$/, '');
  if (/^mongen(?:\.txt)?$/i.test(filename)) {
    const columns = parseMonGenLine(clean, 1)?.columns;
    if (!columns) return [];
    const result: EngineFileCallback[] = [];
    const spawn = columns[engine === 'GEE' ? 14 : 9], warning = columns[17];
    const label = spawn && normalizeStaticDirectCallbackLabel(spawn.value);
    if (label && !columns.some(c => c.start <= spawn.start && /;|\/\//.test(c.value))) {
      result.push({label, start: spawn.start, end: spawn.end, target: 'QFunction-0.txt'});
    }
    const event = engine === 'GOM' && warning && /^1(@[^:\s]+):\d+(?:,\d+)*$/.exec(warning.value);
    if (event && normalizeStaticDirectCallbackLabel(event[1]) && !columns.some(c => c.start <= warning.start && /;|\/\//.test(c.value))) {
      result.push({label: event[1].slice(1), start: warning.start + 1, end: warning.start + 1 + event[1].length, target: 'QMapEvent-0.txt', strict: true});
    }
    return result;
  }
  if (/^mapinfo(?:\.txt)?$/i.test(filename)) {
    if (engine !== 'GOM' || !/^\s*\[[^\]]+\]/.test(clean)) return [];
    const tailStart = clean.indexOf(']') + 1;
    const result: EngineFileCallback[] = [];
    for (const match of clean.slice(tailStart).matchAll(/(?:^|\s)TIMEMAP\([^|()]+\|[^|()]+\|[^|()]+\|(@[^\s|()]+)\)/gi)) {
      const label = normalizeStaticDirectCallbackLabel(match[1]);
      if (!label) continue;
      const start = tailStart + match.index! + match[0].lastIndexOf(match[1]);
      result.push({label, start, end: start + match[1].length, target: 'QFunction-0.txt', strict: true});
    }
    return result;
  }
  if (!action) return [];
  const result: EngineFileCallback[] = findScriptCommandCallbackReferences(clean, engine).map(ref => ({
    label: ref.label, target: ref.targetFileName, start: ref.idSpan.start, end: ref.idSpan.end,
    strict: ref.command === 'SELECTBAGITEM' || ref.command === 'SETONTIMERMS',
  }));
  if (engine === 'GEE' && /^\s*(?:#(?:ACT|ELSEACT)\s+)?ADDDLG\b/i.test(clean)) {
    for (const match of clean.matchAll(/<COUNTDOWN:(?:<\$[^>]*>|[^<>])*?\/@(\d+)>/gi)) {
      const start = match.index! + match[0].lastIndexOf('/@');
      result.push({label: 'DlgButtonClick' + match[1], target: 'QFunction-0.txt', start, end: start + 2 + match[1].length, strict: true});
    }
  }
  return result;
}
