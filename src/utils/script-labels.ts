import { EngineId } from '../types';
import { findScriptCommandInvocations, ScriptTextSpan } from './command-arguments';

export type ScriptLabelReferenceKind = 'ui' | 'goto';

export interface ScriptLabelReference {
  kind: ScriptLabelReferenceKind;
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
  command: 'SETONTIMER' | 'ADDBUTTON' | 'ADDDLG';
  id: string;
  label: string;
  targetFileName: 'QManage.txt' | 'QFunction-0.txt';
  commandSpan: ScriptTextSpan;
  idSpan: ScriptTextSpan;
}

interface NumericScriptCommandCallbackRule {
  valueKind: 'numeric';
  kind: 'timer' | 'button';
  command: 'SETONTIMER' | 'ADDBUTTON';
  argumentIndex: number;
  labelPrefix: 'OnTimer' | 'ButtonClick';
  targetFileName: ScriptCommandCallbackReference['targetFileName'];
}

interface DirectLabelScriptCommandCallbackRule {
  valueKind: 'direct-label';
  kind: 'addDlg';
  command: 'ADDDLG';
  argumentIndex: number;
  engine: 'GOM';
  targetFileName: 'QFunction-0.txt';
}

type ScriptCommandCallbackRule =
  | NumericScriptCommandCallbackRule
  | DirectLabelScriptCommandCallbackRule;

const SCRIPT_COMMAND_CALLBACK_RULES: readonly ScriptCommandCallbackRule[] = [
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
        && (rule.valueKind !== 'direct-label' || rule.engine === engine)
      ));
    }
  );
  const references: ScriptCommandCallbackReference[] = [];
  for (const invocation of invocations) {
    if (invocation.form !== 'line') continue;
    const rule = invocation.command;
    const idSpan = invocation.arguments[rule.argumentIndex];
    if (!idSpan) continue;
    const id = rule.valueKind === 'direct-label'
      ? normalizeStaticDirectCallbackLabel(idSpan.text)
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

export function findScriptLabelReferences(lineText: string): ScriptLabelReference[] {
  if (isScriptCommentLine(lineText)) return [];

  const references: ScriptLabelReference[] = [];
  const uiMarker = /\/@/g;
  let match: RegExpExecArray | null;
  while ((match = uiMarker.exec(lineText)) !== null) {
    const reference = createReference(lineText, 'ui', match.index, match.index + match[0].length);
    if (reference) references.push(reference);
  }

  const gotoMarker = /\bGOTO[\t ]+@/gi;
  while ((match = gotoMarker.exec(lineText)) !== null) {
    const reference = createReference(lineText, 'goto', match.index, match.index + match[0].length);
    if (reference) references.push(reference);
  }

  return references.sort((left, right) => left.markerStart - right.markerStart);
}

export function findScriptLabelReferencesInText(text: string): ScriptLabelReference[] {
  const references: ScriptLabelReference[] = [];
  let lineStart = 0;

  while (lineStart <= text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') lineEnd++;
    for (const reference of findScriptLabelReferences(text.slice(lineStart, lineEnd))) {
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
  for (let line = 0; line < lines.length; line++) {
    for (const reference of findScriptLabelReferences(lines[line])) {
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

function normalizeStaticDirectCallbackLabel(value: string): string | undefined {
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
