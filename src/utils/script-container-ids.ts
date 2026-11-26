import { EngineId } from '../types';

/** Keep the expressions inside GOM dialog IDs visible to variable analysis.
 * The NPC对话框容器 manual defines the first slot as #parent~#element with
 * either side optional. Inline controls assembled by MOV/INC use the same slot.
 */
export function maskDialogContainerIds(text: string, engine: EngineId): string {
  if (engine !== 'GOM' || !text.includes('~') || !text.includes('#')) return text;
  const controls = /<&?(?:COUNTDOWN|IMG|IMGCOUNTDOWN|IMGEX|IMGNUM|INPUTMEMO|INPUTNUM|INPUTTEXT|ITEMBOX|ITEMSHOW|LAYOUT|LISTVIEW|LOOKS|MONSTER|MTEXT|NEWLINE|PLAYIMG|PLAYIMGEX|PROGRESSBAR|TEXT|USERITEM):(?=[ \t]*[#~])/gi;
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(controls)) {
    const start = match.index! + match[0].length;
    if (start < last) continue;
    let cursor = start, plainStart = start, shape = '';
    const plain: Array<[number, number]> = [];
    while (cursor < text.length && !/[:>\r\n]/.test(text[cursor])) {
      if (!text.startsWith('<$', cursor)) { cursor++; continue; }
      shape += text.slice(plainStart, cursor) + 'v';
      plain.push([plainStart, cursor]);
      let depth = 0;
      do {
        if (text[cursor] === '<') depth++;
        if (text[cursor] === '>') depth--;
        cursor++;
      } while (depth > 0 && cursor < text.length && !/[\r\n]/.test(text[cursor]));
      plainStart = cursor;
    }
    if (text[cursor] !== ':' && text[cursor] !== '>') continue;
    shape += text.slice(plainStart, cursor);
    if (!/^\s*(?:#[\p{L}\p{N}_$.-]+)?\s*~\s*(?:#[\p{L}\p{N}_$.-]+)?\s*$/u.test(shape)) continue;
    plain.push([plainStart, cursor]);
    for (const [from, to] of plain) {
      parts.push(text.slice(last, from), ' '.repeat(to - from));
      last = to;
    }
  }
  return parts.length ? parts.join('') + text.slice(last) : text;
}
