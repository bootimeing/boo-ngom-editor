import { EngineId } from '../types';
import { findScriptCommandInvocations, ScriptTextSpan } from './command-arguments';

export type ScriptLabelReferenceKind = 'ui' | 'goto';

export interface ScriptLabelReference {
  kind: ScriptLabelReferenceKind;
  command?: string;
  name: string;
  rawName: string;
  markerStart: number;
  nameStart: number;
  end: number;
}

export interface LocatedScriptLabelReference extends ScriptLabelReference {
  line: number;
}

export interface ScriptLabelDefinition {
  name: string;
  key: string;
  line: number;
  start: number;
  end: number;
}

export interface ScriptLabelResolutionOptions {
  engine?: EngineId;
  additionalDefinedLabelKeys?: ReadonlySet<string>;
  skipSectionedDataDocuments?: boolean;
  isAdditionalDefinedLabel?: (normalizedName: string) => boolean;
}

export type ScriptCommandCallbackKind = 'timer' | 'button' | 'addDlg';

export interface ScriptCommandCallbackReference {
  kind: ScriptCommandCallbackKind;
  command: 'SETONTIMER' | 'SETONTIMERMS' | 'ADDBUTTON' | 'ADDDLG' | 'SELECTBAGITEM';
  id: string;
  label: string;
  targetFileName: 'QManage.txt' | 'QFunction-0.txt';
  commandSpan: ScriptTextSpan;
  idSpan: ScriptTextSpan;
}

interface NumericScriptCommandCallbackRule {
  valueKind: 'numeric';
  kind: 'timer' | 'button';
  command: 'SETONTIMER' | 'SETONTIMERMS' | 'ADDBUTTON';
  engine?: EngineId;
  argumentIndex: number;
  labelPrefix: 'OnTimer' | 'OnTimerMS' | 'ButtonClick';
  targetFileName: ScriptCommandCallbackReference['targetFileName'];
}

interface DirectLabelScriptCommandCallbackRule {
  valueKind: 'direct-label';
  kind: 'addDlg';
  command: 'ADDDLG' | 'SELECTBAGITEM';
  argumentIndex: number;
  engine: 'GOM';
  targetFileName: 'QFunction-0.txt';
}

type ScriptCommandCallbackRule =
  | NumericScriptCommandCallbackRule
  | DirectLabelScriptCommandCallbackRule;

const SCRIPT_COMMAND_CALLBACK_RULES: readonly ScriptCommandCallbackRule[] = [
  {valueKind: 'numeric', kind: 'timer', command: 'SETONTIMERMS', argumentIndex: 0,
    labelPrefix: 'OnTimerMS', targetFileName: 'QManage.txt', engine: '996PC'},
  {valueKind: 'direct-label', kind: 'addDlg', command: 'SELECTBAGITEM', argumentIndex: 0,
    engine: 'GOM', targetFileName: 'QFunction-0.txt'},
  {
    valueKind: 'numeric',
    kind: 'timer',
    command: 'SETONTIMER',
    argumentIndex: 0,
    labelPrefix: 'OnTimer',
    targetFileName: 'QManage.txt',
  },
  {
    valueKind: 'numeric',
    kind: 'button',
    command: 'ADDBUTTON',
    argumentIndex: 1,
    labelPrefix: 'ButtonClick',
    targetFileName: 'QFunction-0.txt',
  },
  {
    valueKind: 'direct-label',
    kind: 'addDlg',
    command: 'ADDDLG',
    argumentIndex: 7,
    engine: 'GOM',
    targetFileName: 'QFunction-0.txt',
  },
];

// Fixed second-argument local targets, verified against each engine's help.
// 996PC documents DelayCall, but its DelayGoto entry has no verified signature.
const LOCAL_CALLBACK_COMMANDS: readonly {
  name: string;
  argument: number;
  engines: readonly EngineId[];
}[] = [
  { name: 'DELAYGOTO', argument: 1, engines: ['GOM', 'GEE'] },
  { name: 'DELAYCALL', argument: 1, engines: ['GOM', 'GEE', '996PC'] },
  { name: 'SENDCENTERMSG', argument: 5, engines: ['GOM', 'GEE'] },
  { name: 'SENDDELAYMSG', argument: 4, engines: ['GOM', 'GEE'] },
  { name: 'HTTPPOST', argument: 3, engines: ['GEE'] },
  { name: 'HTTPGET', argument: 1, engines: ['GEE'] },
  { name: 'PLAYDICE', argument: 1, engines: ['GOM'] },
  { name: 'LOOPBAGITEMS', argument: 0, engines: ['996PC'] },
];

// 官方系统回调标签（按钮/对话标签中的 /@ 或 /@@ 调用），用于避免误报
const OFFICIAL_SYSTEM_UI_LABELS = new Set([
  'BUHERO',
  'BUILDGUILDNOW',
  'CASTLENAME',
  'CHECKNO',
  'COPYTOCLIPBOARD1',
  'CREATEHERO',
  'DEALGOLD',
  'DEALYBME',
  'DONATE',
  'GUILDWAR',
  'OFFLINEMSG',
  'RECEIPTS',
  'SENDMSG',
  'USEITEMNAME',
  'USEITEMNAME0',
  'USEITEMNAME1',
  'USEITEMNAME2',
  'USEITEMNAME3',
  'USEITEMNAME4',
  'USEITEMNAME5',
  'USEITEMNAME6',
  'USEITEMNAME7',
  'USEITEMNAME8',
  'USEITEMNAME9',
  'USEITEMNAME10',
  'USEITEMNAME11',
  'USEITEMNAME12',
  'INPUTSTRING',
  'INPUTSTRING1',
  'INPUTSTRING2',
  'INPUTSTRING3',
  'INPUTSTRING10',
  'INPUTSTRING22',
  'INPUTSTRING40',
  'INPUTSTRING60',
  'INPUTSTRING61',
  'INPUTSTRING62',
  'INPUTSTRING63',
  'INPUTINTEGER',
  'INPUTINTEGER1',
  'INPUTINTEGER2',
  'INPUTINTEGER3',
  'INPUTINTEGER22',
  'INPUTINTEGER41',
  'INPUTINTEGER300',
  'WITHDRAWAL',
]);

export function scriptCodeBeforeComment(line: string): string {
  if (!/(?:^|\s)(?:;|\/\/)/.test(line)) return line;
  let quote = '', angle = 0, group = 0;
  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '<' && /[&$\p{L}]/u.test(line[index + 1] || '')) angle++;
    else if (ch === '>' && angle) angle--;
    else if ('([{'.includes(ch)) group++;
    else if (')]}'.includes(ch) && group) group--;
    else if (!angle && !group && (index === 0 || /\s/.test(line[index - 1])) &&
      (ch === ';' || line.startsWith('//', index))) return line.slice(0, index);
  }
  return line;
}

export function isScriptCommentLine(line: string): boolean {
  return /^\s*(?:;|\/\/)/.test(line);
}

function isReferenceTerminator(character: string): boolean {
  return /\s/.test(character) || character === ']' || character === '>'
    || character === '/' || character === '\\' || character === '(';
}

function isGenericAtLabelTerminator(character: string): boolean {
  return /\s/.test(character) || '[]()<>{},;:/\\'.includes(character);
}

function readUntilTerminator(
  text: string,
  start: number,
  isTerminator: (character: string) => boolean
): string {
  let end = start;
  while (end < text.length && !isTerminator(text[end])) end++;
  return text.slice(start, end);
}

function normalizeReferenceName(rawName: string, kind: ScriptLabelReferenceKind): string {
  // /@@InputStringN and /@@InputIntegerN dispatch to [@InputStringN]/[@InputIntegerN].
  if (kind === 'ui' && /^@INPUT(?:STRING|INTEGER)\d+$/i.test(rawName)) {
    return rawName.slice(1);
  }
  return rawName;
}

function createReference(
  lineText: string,
  kind: ScriptLabelReferenceKind,
  markerStart: number,
  nameStart: number
): ScriptLabelReference | undefined {
  const rawName = readUntilTerminator(lineText, nameStart, isReferenceTerminator);
  if (!rawName) return undefined;
  return {
    kind,
    name: normalizeReferenceName(rawName, kind),
    rawName,
    markerStart,
    nameStart,
    end: nameStart + rawName.length,
  };
}

export function normalizeScriptLabelKey(label: string): string {
  return label.trim().toUpperCase();
}

/**
 * 找出静态命令参数派生的引擎回调标签。
 *
 * 只接受当前帮助已核验的 SETONTIMER、ADDBUTTON 旧命令格式，以及
 * 新 GOM ADDDLG 第 8 参数的直接 @QF字段。相似命令、变量、表达式、
 * 负数以及非 GOM 的 AddDlg 不会被静态猜测。
 */
export function findScriptCommandCallbackReferences(
  lineText: string,
  engine: EngineId
): ScriptCommandCallbackReference[] {
  if (isScriptCommentLine(lineText)) return [];
  const directive = /^\s*#([A-Za-z]+)/.exec(lineText)?.[1].toUpperCase();
  if (directive && directive !== 'ACT' && directive !== 'ELSEACT') return [];

  const invocations = findScriptCommandInvocations(
    lineText,
    typedName => {
      const command = typedName.toUpperCase();
      return SCRIPT_COMMAND_CALLBACK_RULES.find(rule => (
        rule.command === command
        && (!rule.engine || rule.engine === engine)
      ));
    }
  );
  const references: ScriptCommandCallbackReference[] = [];
  for (const invocation of invocations) {
    if (invocation.form !== 'line') continue;
    const rule = invocation.command;
    const idSpan = invocation.arguments[rule.argumentIndex];
    if (!idSpan) continue;
    if (rule.command === 'ADDBUTTON' && engine === '996PC' && invocation.arguments.length === 3) continue;
    const direct = rule.command === 'SELECTBAGITEM' && !idSpan.text.startsWith('@') ? '@' + idSpan.text : idSpan.text;
    const id = rule.valueKind === 'direct-label'
      ? normalizeStaticDirectCallbackLabel(direct)
      : normalizeStaticCallbackId(idSpan.text, rule.kind, engine);
    if (id === undefined) continue;
    references.push({
      kind: rule.kind,
      command: rule.command,
      id,
      label: rule.valueKind === 'direct-label' ? id : `${rule.labelPrefix}${id}`,
      targetFileName: rule.targetFileName,
      commandSpan: invocation.commandSpan,
      idSpan,
    });
  }
  return references;
}

export function findScriptCommandCallbackAt(
  lineText: string,
  character: number,
  engine: EngineId
): ScriptCommandCallbackReference | undefined {
  return findScriptCommandCallbackReferences(lineText, engine).find(reference => (
    isCharacterInSpan(character, reference.commandSpan)
    || isCharacterInSpan(character, reference.idSpan)
  ));
}

export function findScriptLabelDefinitions(lines: string[]): ScriptLabelDefinition[] {
  const definitions: ScriptLabelDefinition[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (isScriptCommentLine(lines[line])) continue;
    const match = /^\s*\[@([^\]]+)\]/.exec(lines[line]);
    if (!match) continue;
    const markerStart = match[0].indexOf('[@');
    definitions.push({
      name: match[1],
      key: normalizeScriptLabelKey(match[1]),
      line,
      start: markerStart,
      end: markerStart + match[0].trimStart().length,
    });
  }
  return definitions;
}

export function isSectionedScriptDataDocument(lines: string[]): boolean {
  let hasSection = false;
  let hasAssignment = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isScriptCommentLine(line)) continue;
    if (/^#(?:IF|OR|ACT|ELSEACT|SAY|ELSESAY|CALL|INCLUDE)\b/i.test(line)
      || /^\[@[^\]]+\]/.test(line)
      || /\bGOTO\s+@/i.test(line)) {
      return false;
    }
    if (/^\[(?![@~])[^\]]+\]$/.test(line)) hasSection = true;
    if (/^[^=[\]]+\s*=/.test(line)) hasAssignment = true;
  }
  return hasSection && hasAssignment;
}

export function isEngineNativeScriptLabelReference(
  reference: ScriptLabelReference
): boolean {
  if (reference.kind !== 'ui') return false;
  const key = normalizeScriptLabelKey(reference.name).replace(/^@+/, '');
  if (OFFICIAL_SYSTEM_UI_LABELS.has(key)) {
    return true;
  }
  return key === 'REQUESTCASTLEWARNOW'
    || key === 'REPAIRDOORNOW'
    || /^REPAIRWALLNOW[1-3]$/.test(key)
    || /^HIREGUARDNOW[1-4]$/.test(key)
    || /^HIREARCHERNOW(?:[1-9]|1[0-2])$/.test(key);
}

export function findScriptLabelReferences(
  lineText: string,
  engine: EngineId = 'GOM',
  allowCommandLabels = true
): ScriptLabelReference[] {
  if (isScriptCommentLine(lineText)) return [];

  const references: ScriptLabelReference[] = [];
  const uiMarker = engine === '996PC' ? /\/@|\|(?:db)?link\s*=\s*@/gi : /\/@/g;
  let match: RegExpExecArray | null;
  while ((match = uiMarker.exec(lineText)) !== null) {
    if (match[0].startsWith('|') && !/<[a-z][a-z0-9]*\|(?:<\$[^>]*>|[^<>])*$/i.test(lineText.slice(0, match.index + 1))) continue;
    const markerStart = match[0].startsWith('|') ? match.index + match[0].length - 1 : match.index;
    const reference = createReference(lineText, 'ui', markerStart, match.index + match[0].length);
    if (reference && engine === '996PC') {
      const end = reference.rawName.search(/[#|]/);
      if (end >= 0) {
        reference.rawName = reference.rawName.slice(0, end);
        reference.name = normalizeReferenceName(reference.rawName, 'ui');
        reference.end = reference.nameStart + end;
      }
    }
    if (reference?.name) references.push(reference);
  }

  const gotoMarker = /\bGOTO[\t ]+@/gi;
  while ((match = gotoMarker.exec(lineText)) !== null) {
    const reference = createReference(lineText, 'goto', match.index, match.index + match[0].length);
    if (reference) references.push(reference);
  }

  if (allowCommandLabels) {
    const directive = /^\s*#([A-Za-z]+)/.exec(lineText)?.[1].toUpperCase();
    if (!directive || directive === 'ACT' || directive === 'ELSEACT') {
      for (const invocation of findScriptCommandInvocations(lineText, typedName => (
        LOCAL_CALLBACK_COMMANDS.find(rule => rule.name === typedName.toUpperCase()
          && rule.engines.includes(engine))
      ))) {
        if (invocation.form !== 'line') continue;
        const argument = invocation.arguments[invocation.command.argument];
        if (!argument) continue;
        const label = normalizeStaticDirectCallbackLabel(argument.text);
        if (!label) continue;
        references.push({ kind: 'goto', command: invocation.command.name,
          name: label, rawName: label, markerStart: argument.start,
          nameStart: argument.start + 1, end: argument.end });
      }
    }
  }

  return references.sort((left, right) => left.markerStart - right.markerStart);
}

export function findScriptLabelReferencesInText(text: string, engine: EngineId = 'GOM'): ScriptLabelReference[] {
  const references: ScriptLabelReference[] = [];
  let lineStart = 0;
  let allowCommandLabels = true;

  while (lineStart <= text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') lineEnd++;
    const lineText = text.slice(lineStart, lineEnd);
    allowCommandLabels = commandLabelsAllowedInBlock(lineText, allowCommandLabels);
    for (const reference of findScriptLabelReferences(lineText, engine, allowCommandLabels)) {
      references.push({
        ...reference,
        markerStart: reference.markerStart + lineStart,
        nameStart: reference.nameStart + lineStart,
        end: reference.end + lineStart,
      });
    }
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return references;
}

export function findUndefinedScriptLabelReferences(
  lines: string[],
  definedLabelKeys: ReadonlySet<string>,
  options: ScriptLabelResolutionOptions = {}
): LocatedScriptLabelReference[] {
  if (options.skipSectionedDataDocuments && isSectionedScriptDataDocument(lines)) {
    return [];
  }
  const unresolved: LocatedScriptLabelReference[] = [];
  let allowCommandLabels = true;
  for (let line = 0; line < lines.length; line++) {
    allowCommandLabels = commandLabelsAllowedInBlock(lines[line], allowCommandLabels);
    for (const reference of findScriptLabelReferences(lines[line], options.engine, allowCommandLabels)) {
      const key = normalizeScriptLabelKey(reference.name);
      if (key === 'EXIT' || key === 'MAIN') continue;
      if (reference.name.includes('<') || /^\d+$/.test(reference.name)) continue;
      if (
        definedLabelKeys.has(key)
        || options.additionalDefinedLabelKeys?.has(key)
        || (options.isAdditionalDefinedLabel && options.isAdditionalDefinedLabel(key))
      ) continue;
      if (isEngineNativeScriptLabelReference(reference)) continue;
      unresolved.push({ ...reference, line });
    }
  }
  return unresolved;
}

function commandLabelsAllowedInBlock(lineText: string, previous: boolean): boolean {
  const directive = /^\s*#(ACT|ELSEACT|SAY|ELSESAY|IF|OR)\b/i.exec(lineText)?.[1].toUpperCase();
  return directive ? directive === 'ACT' || directive === 'ELSEACT' : previous;
}

export function findAtLabelTokenAt(lineText: string, character: number): string | undefined {
  if (isScriptCommentLine(lineText)) return undefined;
  const marker = /@/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(lineText)) !== null) {
    const nameStart = match.index + 1;
    const name = readUntilTerminator(lineText, nameStart, isGenericAtLabelTerminator);
    if (!name) continue;
    const end = nameStart + name.length;
    if (character >= match.index && character <= end) return name;
  }
  return undefined;
}

export function normalizeStaticDirectCallbackLabel(value: string): string | undefined {
  if (!value.startsWith('@')) return undefined;
  const label = readUntilTerminator(value, 1, isGenericAtLabelTerminator);
  if (!label || label.length !== value.length - 1) return undefined;
  return label;
}

function normalizeStaticCallbackId(
  value: string,
  kind: ScriptCommandCallbackKind,
  engine: EngineId
): string | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return undefined;
  const maximum = kind === 'timer' ? 255 : (engine === 'GEE' ? 200 : 100);
  const minimum = kind === 'timer' ? 0 : 1;
  if (numeric < minimum || numeric > maximum) return undefined;
  return String(numeric);
}

function isCharacterInSpan(character: number, span: ScriptTextSpan): boolean {
  return character >= span.start && character < span.end;
}
