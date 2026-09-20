import { EngineId } from '../types';
import { previewVariableContract } from './preview-variable-contracts';

export interface LocalPopupInput {
  target: string;
  variable: string;
  kind: 'text' | 'integer';
  title: string;
}

/** Only the documented direct numbered custom-input link. Titles are not call arguments. */
export function popupInputLink(link: string, engine: EngineId): LocalPopupInput | undefined {
  if (engine !== '996PC') return undefined;
  const match = /^@@InPut(String|Integer)(0|[1-9]\d{0,3})(?:\(([^()<>{}|\r\n$]{0,256})\))?$/i.exec(link.trim());
  if (!match) return undefined;
  const kind = match[1].toLowerCase() === 'string' ? 'text' : 'integer';
  const variable = `${kind === 'text' ? 'S' : 'N'}${match[2]}`;
  if (!previewVariableContract(`NPCPARAMS(1,${variable})`,engine)) return undefined;
  return {target:`@InPut${kind === 'text' ? 'String' : 'Integer'}${match[2]}`,variable,kind,
    title:match[3] || (kind === 'text' ? '请输入文字' : '请输入整数')};
}

export function popupInputRaw(raw: string, engine: EngineId): LocalPopupInput | undefined {
  const matches = [...raw.matchAll(/(?:\/|\|link=)(@@InPut[^>]*)(?=>)/gi)];
  if (matches.length !== 1 || (raw.match(/\|(?:db)?link=|\/@@/gi) || []).length !== 1) return undefined;
  if (/\|link=/i.test(raw) && !/^<(?:Text|Button|Img|Layout)\|/i.test(raw)) return undefined;
  return popupInputLink(matches[0][1],engine);
}

export function popupInputAt(line: string, column: number, engine: EngineId): LocalPopupInput | undefined {
  if (!Number.isInteger(column) || column < 0) return undefined;
  const match = /^(?:\/|\|link=)(@@InPut[^>]*)(?=>)/i.exec(line.slice(column));
  return match ? popupInputLink(match[1],engine) : undefined;
}

export function popupInputColumn(raw: string): number {
  const keyed = raw.toLowerCase().indexOf('|link=');
  return keyed >= 0 ? keyed : raw.indexOf('/@@');
}

export function popupInputValueAccepted(input: LocalPopupInput, value: unknown): value is string {
  // The manual only proves digit-only integer input, not signed/decimal client behavior.
  return typeof value === 'string' && value.length <= 4096 && !/[\r\n\x00]/.test(value)
    && (input.kind === 'text' || /^\d+$/.test(value));
}

export function popupCallbackLabel(reference: string, engine: EngineId): string | undefined {
  if (engine !== '996PC') return undefined;
  return /^(@@InPut(?:String|Integer)(?:0|[1-9]\d{0,3}))(?=\(|$)/i.exec(reference)?.[1].slice(1);
}
